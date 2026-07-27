/**
 * Durable storage for messages that have been accepted locally but not yet
 * confirmed by the server.
 *
 * The delivery controller only ever talks to this interface, so the same
 * controller runs against IndexedDB in the browser and against a plain map in a
 * validation script. That is what makes the send path testable without a DOM.
 *
 * A record is written *before* the composer is cleared and removed only once the
 * server has committed the message, so no state in between can lose the text.
 */
import {
  deletePendingMessage,
  getPendingMessages,
  putPendingMessage,
  recoverInterruptedSends,
  type PendingMessageRecord,
} from "@/lib/e2ee/indexed-db";

export type { PendingMessageRecord };

export interface PendingRepository {
  /** Everything still owed for this chat, oldest first. */
  load(): Promise<PendingMessageRecord[]>;
  /** Write or update by client id. Never creates a second row for a retry. */
  save(record: PendingMessageRecord): Promise<void>;
  /** Called once the message is canonical and stored in the verified cache. */
  remove(clientMessageId: string): Promise<void>;
  /** Moves anything a crashed tab left mid-flight into a retryable state. */
  recoverInterrupted(): Promise<number>;
}

/** IndexedDB-backed repository, scoped to one user and one conversation. */
export function createIndexedDbPendingRepository(userId: string, chatId: string): PendingRepository {
  return {
    async load() {
      const records = await getPendingMessages(userId, chatId);
      return records.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
    async save(record) {
      await putPendingMessage(userId, record);
    },
    async remove(clientMessageId) {
      await deletePendingMessage(userId, clientMessageId);
    },
    async recoverInterrupted() {
      return recoverInterruptedSends(userId);
    },
  };
}

/**
 * In-memory repository with the same semantics, used by the validation scripts
 * and as a fallback when IndexedDB is unavailable (private windows, quota
 * failures). A fallback that throws would lose the message, which is the exact
 * failure this layer exists to prevent — so it degrades to memory instead.
 */
export function createMemoryPendingRepository(seed: PendingMessageRecord[] = []): PendingRepository & {
  /** Test affordance: the records currently held, in insertion order. */
  snapshot(): PendingMessageRecord[];
  /** Test affordance: fail the next N writes, to exercise the degraded path. */
  failWrites(count: number): void;
} {
  const records = new Map<string, PendingMessageRecord>();
  for (const record of seed) records.set(record.clientMessageId, record);
  let failuresLeft = 0;

  return {
    async load() {
      return [...records.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
    async save(record) {
      if (failuresLeft > 0) {
        failuresLeft -= 1;
        throw new Error("pending store unavailable");
      }
      records.set(record.clientMessageId, { ...record, updatedAt: new Date().toISOString() });
    },
    async remove(clientMessageId) {
      records.delete(clientMessageId);
    },
    async recoverInterrupted() {
      let recovered = 0;
      for (const [key, record] of records) {
        if (record.serverId) continue;
        if (record.status !== "sending" && record.status !== "encrypting") continue;
        records.set(key, { ...record, status: "failed", lastErrorCode: "INTERRUPTED" });
        recovered += 1;
      }
      return recovered;
    },
    snapshot() {
      return [...records.values()];
    },
    failWrites(count: number) {
      failuresLeft = count;
    },
  };
}

/**
 * A repository that never throws: writes go to IndexedDB when it works and to a
 * memory mirror when it does not. The mirror is also what a read falls back to,
 * so a message accepted while storage was broken is still retried in this tab.
 */
export function createResilientPendingRepository(
  primary: PendingRepository,
  fallback: PendingRepository = createMemoryPendingRepository(),
  onDegraded?: (error: unknown) => void,
): PendingRepository {
  let degraded = false;
  const degrade = (error: unknown) => {
    if (!degraded) {
      degraded = true;
      onDegraded?.(error);
    }
  };

  return {
    async load() {
      try {
        const primaryRecords = await primary.load();
        const fallbackRecords = await fallback.load();
        if (fallbackRecords.length === 0) return primaryRecords;
        const seen = new Set(primaryRecords.map((record) => record.clientMessageId));
        return [...primaryRecords, ...fallbackRecords.filter((record) => !seen.has(record.clientMessageId))];
      } catch (error) {
        degrade(error);
        return fallback.load();
      }
    },
    async save(record) {
      try {
        await primary.save(record);
      } catch (error) {
        degrade(error);
        await fallback.save(record);
      }
    },
    async remove(clientMessageId) {
      await fallback.remove(clientMessageId).catch(() => {});
      try {
        await primary.remove(clientMessageId);
      } catch (error) {
        degrade(error);
      }
    },
    async recoverInterrupted() {
      try {
        return await primary.recoverInterrupted();
      } catch (error) {
        degrade(error);
        return fallback.recoverInterrupted();
      }
    },
  };
}
