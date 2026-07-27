ALTER TABLE "ChatMember"
  ADD COLUMN IF NOT EXISTS "clearedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "ChatMember_clearedAt_idx"
  ON "ChatMember"("clearedAt");

-- Native Android push: FCM device tokens live in the same table as web-push
-- subscriptions, discriminated by kind ("webpush" | "fcm").
ALTER TABLE "PushSubscription"
  ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'webpush';

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
