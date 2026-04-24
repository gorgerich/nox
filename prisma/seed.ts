import "dotenv/config";

import bcrypt from "bcryptjs";
import { randomBytes, createHash } from "crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

type OptionalSystemSettingClient = PrismaClient & {
  systemSetting?: {
    upsert: (args: {
      where: { key: string };
      update: Record<string, never>;
      create: { key: string; value: string };
    }) => Promise<unknown>;
  };
};

function requireEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

function hashInviteCode(code: string) {
  return createHash("sha256").update(code, "utf8").digest("hex");
}

function createInviteCode() {
  return randomBytes(18).toString("base64url");
}

const connectionString = requireEnv("DATABASE_URL");
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

async function seedEmergencyLockSetting(client: OptionalSystemSettingClient) {
  if (!client.systemSetting) {
    return;
  }

  try {
    await client.systemSetting.upsert({
      where: { key: "emergency_lock" },
      update: {},
      create: {
        key: "emergency_lock",
        value: "false",
      },
    });
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? error.code : null;

    if (code === "P2021" || code === "P2022") {
      return;
    }

    throw error;
  }
}

async function main() {
  const ownerEmail = requireEnv("OWNER_EMAIL").trim().toLowerCase();
  const ownerPassword = requireEnv("OWNER_PASSWORD");
  const ownerLogin = (process.env.OWNER_LOGIN || "owner").trim().toLowerCase();
  const ownerUsername = (process.env.OWNER_USERNAME || "owner").trim().toLowerCase();
  const ownerDisplayName = (process.env.OWNER_DISPLAY_NAME || "Owner").trim();
  const passwordHash = await bcrypt.hash(ownerPassword, 12);

  // Try to find owner by any unique field
  const existingOwner = await prisma.user.findFirst({
    where: {
      OR: [
        { email: ownerEmail },
        { login: ownerLogin },
        { username: ownerUsername }
      ]
    }
  });

  let ownerId: string;

  if (existingOwner) {
    console.log(`Found existing owner: ${existingOwner.email} (ID: ${existingOwner.id})`);
    const updatedOwner = await prisma.user.update({
      where: { id: existingOwner.id },
      data: {
        email: ownerEmail,
        login: ownerLogin,
        username: ownerUsername,
        passwordHash,
        status: "ACTIVE",
        role: "OWNER",
        profile: {
          upsert: {
            update: { displayName: ownerDisplayName },
            create: { displayName: ownerDisplayName },
          },
        },
      },
    });
    ownerId = updatedOwner.id;
  } else {
    console.log(`Creating new owner: ${ownerEmail}`);
    const createdOwner = await prisma.user.create({
      data: {
        email: ownerEmail,
        login: ownerLogin,
        username: ownerUsername,
        passwordHash,
        status: "ACTIVE",
        role: "OWNER",
        profile: {
          create: { displayName: ownerDisplayName },
        },
      },
    });
    ownerId = createdOwner.id;
  }

  await seedEmergencyLockSetting(prisma);

  const rawInviteCode = createInviteCode();
  await prisma.invite.create({
    data: {
      codeHash: hashInviteCode(rawInviteCode),
      createdByUserId: ownerId,
      status: "ACTIVE",
      maxUses: 5,
    },
  });

  console.log(`OWNER_EMAIL=${ownerEmail}`);
  console.log(`OWNER_LOGIN=${ownerLogin}`);
  console.log(`RAW_INVITE_CODE=${rawInviteCode}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
