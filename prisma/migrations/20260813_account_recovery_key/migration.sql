-- The account recovery key: an ECDH keypair whose private half is sealed under
-- a passphrase only the user knows. The server stores ciphertext and public
-- material; it never receives the passphrase or the private key.
CREATE TABLE "AccountRecoveryKey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "salt" TEXT NOT NULL,
    "kdf" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL,
    "iterations" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountRecoveryKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AccountRecoveryKey_userId_key" ON "AccountRecoveryKey"("userId");
CREATE INDEX "AccountRecoveryKey_userId_idx" ON "AccountRecoveryKey"("userId");

ALTER TABLE "AccountRecoveryKey" ADD CONSTRAINT "AccountRecoveryKey_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
