import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

async function test() {
  const connectionString = process.env.DATABASE_URL;
  console.log("Connecting to:", connectionString?.split("@")[1]); // don't log password
  const pool = new pg.Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    const count = await prisma.user.count();
    console.log("User count:", count);
  } catch (err) {
    console.error("DB Error:", err);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

test();
