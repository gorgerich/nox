/**
 * Everything a send route does *after* the message is committed.
 *
 * The rule this file exists to enforce:
 *
 *   the commit succeeded → the message is sent → the request does not fail
 *
 * A message that is durably in Postgres and then reported to the sender as a
 * 500 is the worst outcome available: the sender retries or gives up, the
 * recipient already has it, and nothing in the product can tell the two states
 * apart. Production hit exactly that — a `chat.updatedAt` bump in its own
 * transaction expired under connection-pool pressure (`P2028`) and turned a
 * committed message into an error.
 *
 * So: side effects that are not part of the message's durability run through
 * `afterCommit`. They may fail, they are recorded, and they never change the
 * answer the sender gets.
 *
 * This is not a licence to swallow errors that happen *before* the commit.
 * Those still fail the request, because there the message really is not sent.
 */

/** Stages named so a warning says which side effect failed, not just "post-commit". */
export type AfterCommitStage =
  | "chat-bookkeeping"
  | "socket-publish"
  | "push-notification"
  | "telemetry";

/**
 * Test-only fault injection. Reading it costs one env lookup per stage and it
 * is inert unless the variable is set, which nothing in production does. It
 * exists so `validate:message-send-postcommit` can prove the guarantee for a
 * failure that is otherwise only reachable by breaking a real dependency.
 */
function shouldFail(stage: AfterCommitStage): boolean {
  const stages = process.env.POSTCOMMIT_FAULT_STAGES;
  if (!stages) return false;
  return stages.split(",").map((entry) => entry.trim()).includes(stage);
}

/**
 * Structured, deliberately narrow. The error's name and Prisma code identify
 * what broke; the message is truncated and no request payload is included, so
 * a warning can never carry message text, ciphertext, or key material into the
 * logs.
 */
function describe(error: unknown): Record<string, string> {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return {
      error: error.name,
      ...(typeof code === "string" ? { code } : {}),
      detail: error.message.split("\n")[0].slice(0, 200),
    };
  }
  return { error: "NonError", detail: String(error).slice(0, 200) };
}

export type AfterCommitContext = {
  chatId: string;
  messageId: string;
};

/**
 * Runs a post-commit side effect. Never throws, never rejects.
 *
 * Returns whether the stage succeeded, so a caller that wants to report
 * degraded delivery in the response can — the send itself still succeeded.
 */
export async function afterCommit(
  stage: AfterCommitStage,
  context: AfterCommitContext,
  work: () => unknown | Promise<unknown>,
): Promise<boolean> {
  try {
    if (shouldFail(stage)) throw new Error(`injected ${stage} failure`);
    await work();
    return true;
  } catch (error) {
    console.warn("[message-send] post-commit side effect failed", {
      stage,
      chatId: context.chatId,
      messageId: context.messageId,
      ...describe(error),
    });
    return false;
  }
}
