"use client";

import { useState } from "react";
import { useFocusTrap } from "@/lib/use-focus-trap";
import type { BuiltInFolderItem, ChatFolderItem } from "@/lib/chat-list";
import { SettingsBlock, SettingsGroup, SettingsStack } from "@/components/settings/SettingsGroup";
import {
  SettingsActionRow,
  SettingsInputRow,
  SettingsNavRow,
  SettingsPrimaryButton,
  SettingsToggleRow,
  SettingsValueRow,
} from "@/components/settings/SettingsRow";
import { SettingsScreen } from "@/components/settings/SettingsScreen";
import { ConfirmSheet } from "@/components/settings/ConfirmSheet";

export type FolderChatOption = {
  id: string;
  title: string;
  subtitle: string;
};

const MAX_FOLDERS = 12;

function pluralChats(count: number): string {
  const tail = count % 100;
  if (tail > 10 && tail < 20) return "чатов";
  switch (count % 10) {
    case 1:
      return "чат";
    case 2:
    case 3:
    case 4:
      return "чата";
    default:
      return "чатов";
  }
}

function ReorderButtons({
  onUp,
  onDown,
  disableUp,
  disableDown,
  disabled,
}: {
  onUp: () => void;
  onDown: () => void;
  disableUp: boolean;
  disableDown: boolean;
  disabled: boolean;
}) {
  const button =
    "flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-smooth hover:bg-surface-hover disabled:opacity-25";
  return (
    <div className="flex shrink-0 items-center">
      <button type="button" aria-label="Переместить выше" onClick={onUp} disabled={disabled || disableUp} className={button}>
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="m6 15 6-6 6 6" />
        </svg>
      </button>
      <button type="button" aria-label="Переместить ниже" onClick={onDown} disabled={disabled || disableDown} className={button}>
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="m6 9 6 6 6-6" />
        </svg>
      </button>
    </div>
  );
}

/**
 * Chat folders.
 *
 * The screen used to open on a creation form — a name field, a scrollable list
 * of every chat and a filled blue button — before showing the folders that
 * already exist. That is the editor standing in front of the thing it edits.
 * Now the list comes first and creating opens the same editor an existing
 * folder opens, so there is one way a folder is built, not two.
 */
export function FoldersPanel({
  chatFolders,
  builtInFolders,
  folderChats,
  pending,
  message,
  onSave,
}: {
  chatFolders: ChatFolderItem[];
  builtInFolders: BuiltInFolderItem[];
  folderChats: FolderChatOption[];
  pending: boolean;
  message: string;
  onSave: (folders: ChatFolderItem[], builtIns: BuiltInFolderItem[], successMessage: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState<{ folder: ChatFolderItem | null } | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftChatIds, setDraftChatIds] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<ChatFolderItem | null>(null);

  const editorRef = useFocusTrap<HTMLDivElement>(editing !== null, () => setEditing(null));

  const orderedBuiltIns = [...builtInFolders].sort((left, right) => left.order - right.order);

  function openEditor(folder: ChatFolderItem | null) {
    setDraftName(folder?.name ?? "");
    setDraftChatIds(new Set(folder?.chatIds ?? []));
    setEditing({ folder });
  }

  function toggleDraftChat(chatId: string) {
    setDraftChatIds((current) => {
      const next = new Set(current);
      if (next.has(chatId)) next.delete(chatId);
      else next.add(chatId);
      return next;
    });
  }

  async function saveDraft() {
    const name = draftName.trim();
    if (!name || draftChatIds.size === 0 || pending || !editing) return;

    const existing = editing.folder;
    const next: ChatFolderItem = existing
      ? { ...existing, name, chatIds: Array.from(draftChatIds) }
      : {
          id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
          name,
          chatIds: Array.from(draftChatIds),
          createdAt: new Date().toISOString(),
        };

    const folders = existing
      ? chatFolders.map((folder) => (folder.id === existing.id ? next : folder))
      : [...chatFolders, next];

    await onSave(folders, builtInFolders, existing ? "Папка обновлена." : "Папка создана.");
    setEditing(null);
  }

  async function deleteFolder(folder: ChatFolderItem) {
    setConfirmDelete(null);
    await onSave(chatFolders.filter((item) => item.id !== folder.id), builtInFolders, "Папка удалена.");
    setEditing(null);
  }

  async function moveBuiltIn(key: BuiltInFolderItem["key"], direction: -1 | 1) {
    const next = [...orderedBuiltIns];
    const index = next.findIndex((folder) => folder.key === key);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    await onSave(chatFolders, next.map((folder, order) => ({ ...folder, order })), "Порядок обновлён.");
  }

  async function moveCustom(folderId: string, direction: -1 | 1) {
    const next = [...chatFolders];
    const index = next.findIndex((folder) => folder.id === folderId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    await onSave(next, builtInFolders, "Порядок обновлён.");
  }

  const canSaveDraft = draftName.trim().length > 0 && draftChatIds.size > 0 && !pending;

  return (
    <>
      <SettingsStack>
        <SettingsGroup
          label="Мои папки"
          footer={
            chatFolders.length >= MAX_FOLDERS
              ? `Больше ${MAX_FOLDERS} папок создать нельзя.`
              : "Папки появляются рядом с системными разделами над списком чатов."
          }
        >
          {chatFolders.length > 0
            ? chatFolders.map((folder, index) => (
                <div key={folder.id} className="flex items-center pl-2">
                  <ReorderButtons
                    onUp={() => void moveCustom(folder.id, -1)}
                    onDown={() => void moveCustom(folder.id, 1)}
                    disableUp={index === 0}
                    disableDown={index === chatFolders.length - 1}
                    disabled={pending}
                  />
                  <div className="min-w-0 flex-1">
                    <SettingsNavRow
                      title={folder.name}
                      value={`${folder.chatIds.length} ${pluralChats(folder.chatIds.length)}`}
                      onClick={() => openEditor(folder)}
                    />
                  </div>
                </div>
              ))
            : (
              <SettingsValueRow
                title="Папок пока нет"
                subtitle="Папка группирует выбранные чаты в отдельную вкладку."
              />
            )}
          <SettingsActionRow
            title="Новая папка"
            onClick={() => openEditor(null)}
            disabled={pending || chatFolders.length >= MAX_FOLDERS || folderChats.length === 0}
            subtitle={folderChats.length === 0 ? "Сначала создайте чат." : undefined}
          />
        </SettingsGroup>

        <SettingsGroup
          label="Системные папки"
          footer="Скрытая папка не удаляется — она просто не показывается над списком чатов."
        >
          {orderedBuiltIns.map((folder, index) => (
            <div key={folder.key} className="flex items-center pl-2">
              <ReorderButtons
                onUp={() => void moveBuiltIn(folder.key, -1)}
                onDown={() => void moveBuiltIn(folder.key, 1)}
                disableUp={index === 0}
                disableDown={index === orderedBuiltIns.length - 1}
                disabled={pending}
              />
              <div className="min-w-0 flex-1">
                <SettingsToggleRow
                  title={folder.label}
                  checked={folder.visible}
                  disabled={pending}
                  onChange={() =>
                    void onSave(
                      chatFolders,
                      builtInFolders.map((item) =>
                        item.key === folder.key ? { ...item, visible: !item.visible } : item,
                      ),
                      "Папки обновлены.",
                    )
                  }
                />
              </div>
            </div>
          ))}
        </SettingsGroup>

        {message ? (
          <p role="status" className="px-5 text-[13px] text-muted">{message}</p>
        ) : null}
      </SettingsStack>

      {editing ? (
        <SettingsScreen
          title={editing.folder ? "Папка" : "Новая папка"}
          titleId="folder-editor-title"
          onBack={() => setEditing(null)}
          containerRef={editorRef}
        >
          <SettingsStack>
            <SettingsGroup label="Название">
              <SettingsInputRow
                id="folder-name"
                label="Имя"
                value={draftName}
                onChange={setDraftName}
                placeholder="Работа"
                maxLength={28}
              />
            </SettingsGroup>

            <SettingsGroup
              label="Чаты в папке"
              footer={
                draftChatIds.size === 0
                  ? "Выберите хотя бы один чат."
                  : `Выбрано: ${draftChatIds.size}`
              }
            >
              {folderChats.map((chat) => {
                const selected = draftChatIds.has(chat.id);
                return (
                  <button
                    key={chat.id}
                    type="button"
                    onClick={() => toggleDraftChat(chat.id)}
                    aria-pressed={selected}
                    className="flex min-h-[52px] w-full items-center gap-3 px-4 py-3 text-left transition-smooth hover:bg-surface-hover active:bg-surface-hover"
                  >
                    <span
                      aria-hidden="true"
                      className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border transition-smooth ${
                        selected ? "border-primary bg-primary text-primary-foreground" : "border-border-subtle"
                      }`}
                    >
                      {selected ? (
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      ) : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[17px] text-foreground">{chat.title}</span>
                      <span className="mt-0.5 block truncate text-[13px] text-muted">{chat.subtitle}</span>
                    </span>
                  </button>
                );
              })}
            </SettingsGroup>

            <SettingsBlock>
              <SettingsPrimaryButton onClick={() => void saveDraft()} disabled={!canSaveDraft}>
                {pending ? "Сохранение…" : editing.folder ? "Сохранить" : "Создать папку"}
              </SettingsPrimaryButton>
            </SettingsBlock>

            {editing.folder ? (
              <SettingsGroup>
                <SettingsActionRow
                  title="Удалить папку"
                  tone="danger"
                  disabled={pending}
                  onClick={() => setConfirmDelete(editing.folder)}
                />
              </SettingsGroup>
            ) : null}
          </SettingsStack>
        </SettingsScreen>
      ) : null}

      <ConfirmSheet
        open={Boolean(confirmDelete)}
        title="Удалить папку?"
        body="Чаты останутся на месте — исчезнет только вкладка."
        confirmLabel="Удалить папку"
        busy={pending}
        onConfirm={() => { if (confirmDelete) void deleteFolder(confirmDelete); }}
        onCancel={() => setConfirmDelete(null)}
      />
    </>
  );
}
