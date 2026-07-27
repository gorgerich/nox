ALTER TABLE "ChatMember"
  ADD COLUMN IF NOT EXISTS "clearedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "ChatMember_clearedAt_idx"
  ON "ChatMember"("clearedAt");

-- Native Android push: FCM device tokens live in the same table as web-push
-- subscriptions, discriminated by kind ("webpush" | "fcm").
ALTER TABLE "PushSubscription"
  ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'webpush';
