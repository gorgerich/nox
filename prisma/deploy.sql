ALTER TABLE "ChatMember"
  ADD COLUMN IF NOT EXISTS "clearedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "ChatMember_clearedAt_idx"
  ON "ChatMember"("clearedAt");
