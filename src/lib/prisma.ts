import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export function getPrisma() {
  if (!globalForPrisma.prisma) {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
      throw new Error("DATABASE_URL is required.");
    }

    // An explicit pool ceiling, used by the pool-pressure validation to run the
    // send route against the smallest pool the driver allows. Unset in
    // production, where the driver default applies exactly as before.
    const poolMax = Number(process.env.DATABASE_POOL_MAX);

    globalForPrisma.prisma = new PrismaClient({
      adapter: new PrismaPg({
        connectionString,
        ...(Number.isFinite(poolMax) && poolMax > 0 ? { max: poolMax } : {}),
      }),
    });
  }

  return globalForPrisma.prisma;
}
