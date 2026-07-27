-- Send idempotency: Message.clientMessageId + unique (senderUserId, clientMessageId).
--
-- NOT APPLIED TO PRODUCTION and deliberately NOT wired into prisma/deploy.sql.
-- It is applied only to the disposable local test database by the message
-- validation scripts.
--
-- RELEASE PREREQUISITE: the send route writes this column, so this statement
-- must be applied BEFORE the route change is deployed. Deploying the code
-- first would break sending outright.
--
-- Safety: additive and nullable, so existing rows are untouched; NULLs are
-- distinct in a Postgres unique index, so legacy messages without an id never
-- collide. Idempotent — verified by running it twice against the test database.
--
-- Rollback:
--   DROP INDEX IF EXISTS "Message_senderUserId_clientMessageId_key";
--   ALTER TABLE "Message" DROP COLUMN IF EXISTS "clientMessageId";
-- Dropping the column loses only idempotency keys, never message content.

-- Send idempotency. The client mints a stable id before the first request;
-- paired with the sender it lets a retry return the message already committed
-- instead of creating a second one. Nullable and additive, so existing rows are
-- untouched; NULLs are distinct in a Postgres unique index, so legacy messages
-- without an id never collide.
--
-- This runs on deploy because the send route now writes the column: shipping
-- the code without it would break sending outright.
ALTER TABLE "Message"
  ADD COLUMN IF NOT EXISTS "clientMessageId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Message_senderUserId_clientMessageId_key"
  ON "Message"("senderUserId", "clientMessageId");
