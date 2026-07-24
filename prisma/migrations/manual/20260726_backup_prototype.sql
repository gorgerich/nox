-- E2EE backup prototype tables (Phase C).
--
-- NOT APPLIED TO PRODUCTION. Reviewed and applied deliberately once the
-- Phase D security validation gate passes. The tables are inert while the
-- E2EE_BACKUP_* flags are off, and nothing here references the messaging
-- tables, so creating them cannot affect message delivery.

-- CreateEnum
CREATE TYPE "BackupAccountStatus" AS ENUM ('DISABLED', 'ACTIVE', 'PAUSED', 'ERROR');

-- CreateEnum
CREATE TYPE "BackupGenerationStatus" AS ENUM ('IN_PROGRESS', 'COMPLETE', 'FAILED', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "BackupAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "backupVersion" INTEGER NOT NULL DEFAULT 1,
    "status" "BackupAccountStatus" NOT NULL DEFAULT 'DISABLED',
    "wrappedRootKey" TEXT,
    "wrappedRootKeyNonce" TEXT,
    "wrappedRootKeySalt" TEXT,
    "latestCompleteGeneration" INTEGER,
    "previousCompleteGeneration" INTEGER,
    "quotaBytes" BIGINT,
    "usedBytes" BIGINT NOT NULL DEFAULT 0,
    "reservedBytes" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackupAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackupGeneration" (
    "id" TEXT NOT NULL,
    "backupAccountId" TEXT NOT NULL,
    "generationNumber" INTEGER NOT NULL,
    "status" "BackupGenerationStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "encryptedManifest" TEXT,
    "manifestNonce" TEXT,
    "wrappedGenerationKey" TEXT,
    "wrappedGenerationKeyNonce" TEXT,
    "previousManifestHash" TEXT,
    "totalChunks" INTEGER NOT NULL DEFAULT 0,
    "uploadedChunks" INTEGER NOT NULL DEFAULT 0,
    "totalBytes" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "BackupGeneration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackupChunk" (
    "id" TEXT NOT NULL,
    "generationId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "byteLength" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BackupChunk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BackupAccount_userId_key" ON "BackupAccount"("userId");

-- CreateIndex
CREATE INDEX "BackupAccount_status_idx" ON "BackupAccount"("status");

-- CreateIndex
CREATE INDEX "BackupGeneration_backupAccountId_status_idx" ON "BackupGeneration"("backupAccountId", "status");

-- CreateIndex
CREATE INDEX "BackupGeneration_expiresAt_idx" ON "BackupGeneration"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "BackupGeneration_backupAccountId_generationNumber_key" ON "BackupGeneration"("backupAccountId", "generationNumber");

-- CreateIndex
CREATE INDEX "BackupChunk_generationId_idx" ON "BackupChunk"("generationId");

-- CreateIndex
CREATE UNIQUE INDEX "BackupChunk_generationId_chunkIndex_key" ON "BackupChunk"("generationId", "chunkIndex");

-- AddForeignKey
ALTER TABLE "BackupAccount" ADD CONSTRAINT "BackupAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BackupGeneration" ADD CONSTRAINT "BackupGeneration_backupAccountId_fkey" FOREIGN KEY ("backupAccountId") REFERENCES "BackupAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BackupChunk" ADD CONSTRAINT "BackupChunk_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "BackupGeneration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
