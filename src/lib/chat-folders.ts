import { randomUUID } from "crypto";
import { getPrisma } from "@/lib/prisma";

export type ChatFolderItem = {
  id: string;
  name: string;
  chatIds: string[];
  createdAt: string;
};

export type BuiltInFolderKey = "personal" | "important" | "unread";

export type BuiltInFolderItem = {
  key: BuiltInFolderKey;
  label: string;
  visible: boolean;
  order: number;
};

export type ChatFolderSettings = {
  builtIns: BuiltInFolderItem[];
  folders: ChatFolderItem[];
};

const MAX_FOLDERS = 12;
const MAX_FOLDER_CHATS = 200;
const BUILT_IN_FOLDERS: BuiltInFolderItem[] = [
  { key: "personal", label: "Личное", visible: true, order: 0 },
  { key: "important", label: "Важное", visible: true, order: 1 },
  { key: "unread", label: "Непрочитанные", visible: true, order: 2 },
];

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

function normalizeBuiltIns(value: unknown): BuiltInFolderItem[] {
  const submitted = Array.isArray(value) ? value : [];
  const byKey = new Map(
    submitted
      .map((item) => item as Partial<BuiltInFolderItem>)
      .filter((item): item is Partial<BuiltInFolderItem> & { key: BuiltInFolderKey } =>
        item.key === "personal" || item.key === "important" || item.key === "unread",
      )
      .map((item) => [item.key, item]),
  );

  return BUILT_IN_FOLDERS.map((defaultItem) => {
    const current = byKey.get(defaultItem.key);
    return {
      ...defaultItem,
      visible: typeof current?.visible === "boolean" ? current.visible : defaultItem.visible,
      order: typeof current?.order === "number" && Number.isFinite(current.order) ? current.order : defaultItem.order,
    };
  })
    .sort((left, right) => left.order - right.order)
    .map((item, index) => ({ ...item, order: index }));
}

function normalizeSettings(value: unknown): ChatFolderSettings {
  if (Array.isArray(value)) {
    return {
      builtIns: normalizeBuiltIns(null),
      folders: normalizeFolders(value),
    };
  }

  const settings = value as Partial<ChatFolderSettings> | null;
  return {
    builtIns: normalizeBuiltIns(settings?.builtIns),
    folders: normalizeFolders(settings?.folders),
  };
}

export async function getChatFolderSettings(userId: string): Promise<ChatFolderSettings> {
  const prisma = getPrisma();
  const setting = await prisma.systemSetting.findUnique({
    where: { key: settingKey(userId) },
    select: { value: true },
  });

  if (!setting?.value) return normalizeSettings(null);

  try {
    return normalizeSettings(JSON.parse(setting.value));
  } catch {
    return normalizeSettings(null);
  }
}

export async function getChatFolders(userId: string) {
  const settings = await getChatFolderSettings(userId);
  return settings.folders;
}

export async function saveChatFolderSettings(userId: string, settings: unknown): Promise<ChatFolderSettings> {
  const normalized = normalizeSettings(settings);
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

export async function saveChatFolders(userId: string, folders: unknown) {
  const current = await getChatFolderSettings(userId);
  const settings = await saveChatFolderSettings(userId, { folders, builtIns: current.builtIns });
  return settings.folders;
}
