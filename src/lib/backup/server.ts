/**
 * Server-side backup generation lifecycle.
 *
 * Never receives the recovery secret, the backup root key or an unwrapped
 * generation key: callers hand over ciphertext and already-wrapped key material
 * only. Nothing here reads or writes Message / MessageEnvelope / Device.
 *
 * Isolation caveat, stated precisely: these tables have no required relation to
 * the messaging tables and the delivery path never calls into this module, so a
 * backup failure cannot change a message's send status. They do, however, share
 * the same database, connection pool, process and bandwidth as delivery, so
 * isolation under load has to be demonstrated by tests rather than inferred
 * from the absence of foreign keys.
 */
import type { PrismaClient } from "@prisma/client";

export type BackupPrisma = Pick<PrismaClient, "backupAccount" | "backupGeneration" | "backupChunk" | "$transaction">;

export const MAX_CHUNK_BYTES = 1_024 * 1_024; // 1 MiB of ciphertext per chunk
export const MAX_GENERATION_CHUNKS = 4_096;
export const IN_PROGRESS_TTL_MS = 24 * 60 * 60 * 1000;

export class BackupError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

/** Opaque, non-reversible account reference used in AAD. */
export function accountBinding(userId: string, backupAccountId: string): string {
  return `${backupAccountId}:${userId.slice(0, 8)}`;
}

export async function ensureBackupAccount(prisma: BackupPrisma, userId: string, quotaBytes: bigint | null) {
  const existing = await prisma.backupAccount.findUnique({ where: { userId } });
  if (existing) return existing;
  return prisma.backupAccount.create({ data: { userId, quotaBytes, status: "ACTIVE" } });
}

/**
 * Creates an in-progress generation. The generation number is assigned by the
 * server — a client cannot choose it — and only one in-progress generation may
 * exist per account at a time.
 */
export async function createGeneration(
  prisma: BackupPrisma,
  params: { userId: string; estimatedBytes: bigint },
) {
  return prisma.$transaction(async (tx) => {
    const account = await tx.backupAccount.findUnique({ where: { userId: params.userId } });
    if (!account) throw new BackupError("BACKUP_ACCOUNT_MISSING");

    const inProgress = await tx.backupGeneration.findFirst({
      where: { backupAccountId: account.id, status: "IN_PROGRESS" },
    });
    if (inProgress) {
      // Resuming an interrupted upload is fine; starting a second concurrent
      // one is not, because chunk counters would collide under one key.
      if (inProgress.expiresAt && inProgress.expiresAt.getTime() > Date.now()) {
        return inProgress;
      }
      await tx.backupGeneration.update({ where: { id: inProgress.id }, data: { status: "FAILED" } });
      await tx.backupAccount.update({
        where: { id: account.id },
        data: { reservedBytes: { decrement: inProgress.reservedBytes } },
      });
    }

    if (account.quotaBytes !== null) {
      const projected = account.usedBytes + account.reservedBytes + params.estimatedBytes;
      if (projected > account.quotaBytes) throw new BackupError("BACKUP_QUOTA_EXCEEDED");
    }

    const highest = await tx.backupGeneration.findFirst({
      where: { backupAccountId: account.id },
      orderBy: { generationNumber: "desc" },
      select: { generationNumber: true },
    });

    const generation = await tx.backupGeneration.create({
      data: {
        backupAccountId: account.id,
        generationNumber: (highest?.generationNumber ?? 0) + 1,
        status: "IN_PROGRESS",
        reservedBytes: params.estimatedBytes,
        expiresAt: new Date(Date.now() + IN_PROGRESS_TTL_MS),
      },
    });

    await tx.backupAccount.update({
      where: { id: account.id },
      data: { reservedBytes: { increment: params.estimatedBytes } },
    });

    return generation;
  });
}

/** Ownership check used by every mutating call; never trusts a client-supplied user id. */
async function ownedGeneration(prisma: BackupPrisma, userId: string, generationId: string) {
  const generation = await prisma.backupGeneration.findUnique({
    where: { id: generationId },
    include: { backupAccount: { select: { userId: true, id: true } } },
  });
  // Indistinguishable response for "missing" and "someone else's", so the
  // endpoint cannot be used to probe for other accounts' backups.
  if (!generation || generation.backupAccount.userId !== userId) throw new BackupError("BACKUP_NOT_FOUND");
  return generation;
}

export async function uploadChunk(
  prisma: BackupPrisma,
  params: { userId: string; generationId: string; chunkIndex: number; ciphertext: string; nonce: string },
) {
  const generation = await ownedGeneration(prisma, params.userId, params.generationId);
  if (generation.status !== "IN_PROGRESS") throw new BackupError("BACKUP_GENERATION_NOT_OPEN");
  if (!Number.isInteger(params.chunkIndex) || params.chunkIndex < 0 || params.chunkIndex >= MAX_GENERATION_CHUNKS) {
    throw new BackupError("BACKUP_CHUNK_INDEX_RANGE");
  }

  const byteLength = params.ciphertext.length;
  if (byteLength > MAX_CHUNK_BYTES) throw new BackupError("BACKUP_CHUNK_TOO_LARGE");

  const existing = await prisma.backupChunk.findUnique({
    where: { generationId_chunkIndex: { generationId: generation.id, chunkIndex: params.chunkIndex } },
  });

  if (existing) {
    // Idempotent retry of the identical chunk succeeds; a *different* payload
    // at the same index is refused, because re-encrypting under the same
    // (key, nonce) would be unsafe and silently replacing it would corrupt the
    // manifest's view of the generation.
    if (existing.ciphertext === params.ciphertext && existing.nonce === params.nonce) return existing;
    throw new BackupError("BACKUP_CHUNK_CONFLICT");
  }

  return prisma.$transaction(async (tx) => {
    const chunk = await tx.backupChunk.create({
      data: {
        generationId: generation.id,
        chunkIndex: params.chunkIndex,
        ciphertext: params.ciphertext,
        nonce: params.nonce,
        byteLength,
      },
    });
    await tx.backupGeneration.update({
      where: { id: generation.id },
      data: { uploadedChunks: { increment: 1 }, totalBytes: { increment: BigInt(byteLength) } },
    });
    return chunk;
  });
}

export async function putManifest(
  prisma: BackupPrisma,
  params: {
    userId: string;
    generationId: string;
    encryptedManifest: string;
    manifestNonce: string;
    wrappedGenerationKey: string;
    wrappedGenerationKeyNonce: string;
    totalChunks: number;
    previousManifestHash: string | null;
  },
) {
  const generation = await ownedGeneration(prisma, params.userId, params.generationId);
  if (generation.status !== "IN_PROGRESS") throw new BackupError("BACKUP_GENERATION_NOT_OPEN");

  return prisma.backupGeneration.update({
    where: { id: generation.id },
    data: {
      encryptedManifest: params.encryptedManifest,
      manifestNonce: params.manifestNonce,
      wrappedGenerationKey: params.wrappedGenerationKey,
      wrappedGenerationKeyNonce: params.wrappedGenerationKeyNonce,
      totalChunks: params.totalChunks,
      previousManifestHash: params.previousManifestHash,
    },
  });
}

/**
 * Transactional activation. An incomplete generation can never become a
 * restore candidate: the manifest must be present and every chunk index from
 * 0..totalChunks-1 must exist, with no gaps, before the pointers move.
 */
export async function activateGeneration(prisma: BackupPrisma, params: { userId: string; generationId: string }) {
  const owned = await ownedGeneration(prisma, params.userId, params.generationId);

  return prisma.$transaction(async (tx) => {
    const generation = await tx.backupGeneration.findUnique({ where: { id: owned.id } });
    if (!generation) throw new BackupError("BACKUP_NOT_FOUND");
    if (generation.status !== "IN_PROGRESS") throw new BackupError("BACKUP_GENERATION_NOT_OPEN");
    if (!generation.encryptedManifest || !generation.wrappedGenerationKey) throw new BackupError("BACKUP_MANIFEST_MISSING");
    if (generation.totalChunks <= 0) throw new BackupError("BACKUP_NO_CHUNKS");

    const chunks = await tx.backupChunk.findMany({
      where: { generationId: generation.id },
      select: { chunkIndex: true, byteLength: true },
      orderBy: { chunkIndex: "asc" },
    });
    if (chunks.length !== generation.totalChunks) throw new BackupError("BACKUP_CHUNK_COUNT_MISMATCH");
    for (let i = 0; i < chunks.length; i += 1) {
      if (chunks[i].chunkIndex !== i) throw new BackupError("BACKUP_CHUNK_GAP");
    }

    const actualBytes = chunks.reduce((total, chunk) => total + BigInt(chunk.byteLength), BigInt(0));
    if (actualBytes !== generation.totalBytes) throw new BackupError("BACKUP_BYTE_MISMATCH");

    const account = await tx.backupAccount.findUnique({ where: { id: generation.backupAccountId } });
    if (!account) throw new BackupError("BACKUP_ACCOUNT_MISSING");

    // Rotate the pointers: latest → previous, previous → superseded.
    if (account.previousCompleteGeneration !== null) {
      await tx.backupGeneration.updateMany({
        where: { backupAccountId: account.id, generationNumber: account.previousCompleteGeneration, status: "COMPLETE" },
        data: { status: "SUPERSEDED" },
      });
    }

    await tx.backupGeneration.update({
      where: { id: generation.id },
      data: { status: "COMPLETE", completedAt: new Date(), expiresAt: null },
    });

    await tx.backupAccount.update({
      where: { id: account.id },
      data: {
        previousCompleteGeneration: account.latestCompleteGeneration,
        latestCompleteGeneration: generation.generationNumber,
        usedBytes: { increment: generation.totalBytes },
        // Release exactly what was reserved for this generation. Releasing the
        // *actual* byte count instead left a residue whenever the upload came
        // in smaller than the estimate, permanently leaking quota.
        reservedBytes: { decrement: generation.reservedBytes },
      },
    });

    return tx.backupGeneration.findUniqueOrThrow({ where: { id: generation.id } });
  });
}

/** Metadata a restoring client needs. Returns nothing for another user's backup. */
export async function getRestoreMetadata(prisma: BackupPrisma, params: { userId: string }) {
  const account = await prisma.backupAccount.findUnique({ where: { userId: params.userId } });
  if (!account || account.latestCompleteGeneration === null) return null;

  const generation = await prisma.backupGeneration.findFirst({
    where: { backupAccountId: account.id, generationNumber: account.latestCompleteGeneration, status: "COMPLETE" },
  });
  if (!generation) return null;

  return {
    generationNumber: generation.generationNumber,
    encryptedManifest: generation.encryptedManifest,
    manifestNonce: generation.manifestNonce,
    wrappedGenerationKey: generation.wrappedGenerationKey,
    wrappedGenerationKeyNonce: generation.wrappedGenerationKeyNonce,
    wrappedRootKey: account.wrappedRootKey,
    wrappedRootKeyNonce: account.wrappedRootKeyNonce,
    wrappedRootKeySalt: account.wrappedRootKeySalt,
    totalChunks: generation.totalChunks,
    totalBytes: generation.totalBytes,
    backupVersion: account.backupVersion,
    previousCompleteGeneration: account.previousCompleteGeneration,
  };
}

export async function getChunk(prisma: BackupPrisma, params: { userId: string; generationNumber: number; chunkIndex: number }) {
  const account = await prisma.backupAccount.findUnique({ where: { userId: params.userId } });
  if (!account) throw new BackupError("BACKUP_NOT_FOUND");

  const generation = await prisma.backupGeneration.findFirst({
    where: { backupAccountId: account.id, generationNumber: params.generationNumber, status: "COMPLETE" },
    select: { id: true },
  });
  if (!generation) throw new BackupError("BACKUP_NOT_FOUND");

  const chunk = await prisma.backupChunk.findUnique({
    where: { generationId_chunkIndex: { generationId: generation.id, chunkIndex: params.chunkIndex } },
    select: { chunkIndex: true, ciphertext: true, nonce: true },
  });
  if (!chunk) throw new BackupError("BACKUP_NOT_FOUND");
  return chunk;
}
