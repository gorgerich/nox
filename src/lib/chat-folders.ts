import { randomUUID } from "crypto";
import { getPrisma } from "@/lib/prisma";

export type ChatFolderItem = {
  id: string;
  name: string;
  chatIds: string[];
  createdAt: string;
};

const MAX_FOLDERS = 12;
const MAX_FOLDER_CHATS = 200;

function settingKey(userId: string) {
  return `chatFolders:${userId}`;
}

function normalizeFolders(value: unknown): ChatFolderItem[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item): ChatFolderItem | null => {
      const folder = item as Partial<ChatFolderItem>;
      const id = typeof folder.id === "string" ? folder.id : randomUUID();
      const name = typeof folder.name === "string" ? folder.name.trim().slice(0, 28) : "";
      const createdAt = typeof folder.createdAt === "string" ? folder.createdAt : new Date().toISOString();
      const chatIds = Array.isArray(folder.chatIds)
        ? [...new Set(folder.chatIds.filter((chatId): chatId is string => typeof chatId === "string"))].slice(0, MAX_FOLDER_CHATS)
        : [];

      if (!name) return null;
      return { id, name, chatIds, createdAt };
    })
    .filter((item): item is ChatFolderItem => Boolean(item))
    .slice(0, MAX_FOLDERS);
}

export async function getChatFolders(userId: string) {
  const prisma = getPrisma();
  const setting = await prisma.systemSetting.findUnique({
    where: { key: settingKey(userId) },
    select: { value: true },
  });

  if (!setting?.value) return [];

  try {
    return normalizeFolders(JSON.parse(setting.value));
  } catch {
    return [];
  }
}

export async function saveChatFolders(userId: string, folders: unknown) {
  const normalized = normalizeFolders(folders);
  const prisma = getPrisma();

  await prisma.systemSetting.upsert({
    where: { key: settingKey(userId) },
    create: {
      key: settingKey(userId),
      value: JSON.stringify(normalized),
    },
    update: {
      value: JSON.stringify(normalized),
    },
  });

  return normalized;
}
