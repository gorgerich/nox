"use client";

import { useCallback, useEffect, useState } from "react";
import {
  countCachedMessages,
  clearCachedMessages,
  clearCryptoKeys,
} from "@/lib/e2ee/indexed-db";
import { SettingsBlock, SettingsGroup, SettingsStack } from "@/components/settings/SettingsGroup";
import { SettingsActionRow, SettingsNote } from "@/components/settings/SettingsRow";
import { ConfirmSheet } from "@/components/settings/ConfirmSheet";

type ClearKind = "messages" | "browser" | "all" | "keys";

async function clearBrowserCaches(): Promise<void> {
  if (typeof caches === "undefined") return;
  const names = await caches.keys();
  await Promise.all(names.map((name) => caches.delete(name)));
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} ГБ`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} МБ`;
  return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
}

function pluralMessages(count: number): string {
  const tail = count % 100;
  if (tail > 10 && tail < 20) return "сообщений";
  switch (count % 10) {
    case 1:
      return "сообщение";
    case 2:
    case 3:
    case 4:
      return "сообщения";
    default:
      return "сообщений";
  }
}

/**
 * Storage and cache.
 *
 * The browser reports one number — total bytes this origin occupies — and no
 * breakdown by kind. So there is no photos/videos/files split here: inventing
 * one would mean showing the user four numbers, three of which are guesses.
 * What is shown is what can be measured, plus what clearing each thing costs.
 */
export function CacheSettings() {
  const [messageCount, setMessageCount] = useState<number | null>(null);
  const [usage, setUsage] = useState<number | null>(null);
  const [quota, setQuota] = useState<number | null>(null);
  const [busy, setBusy] = useState<ClearKind | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pendingClear, setPendingClear] = useState<ClearKind | null>(null);

  const refresh = useCallback(async () => {
    const count = await countCachedMessages().catch(() => 0);
    setMessageCount(count);
    if (typeof navigator !== "undefined" && navigator.storage?.estimate) {
      try {
        const estimate = await navigator.storage.estimate();
        setUsage(estimate.usage ?? null);
        setQuota(estimate.quota ?? null);
      } catch {
        setUsage(null);
        setQuota(null);
      }
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void refresh());
  }, [refresh]);

  const runClear = useCallback(
    async (kind: ClearKind) => {
      setBusy(kind);
      setNote(null);
      try {
        if (kind === "messages" || kind === "all") await clearCachedMessages();
        if (kind === "browser" || kind === "all") await clearBrowserCaches();
        if (kind === "keys") {
          await clearCryptoKeys();
          await clearCachedMessages();
        }
        // Verify the wipe actually took effect.
        const remaining = await countCachedMessages().catch(() => -1);
        await refresh();
        setNote(
          kind === "keys"
            ? "Ключи и кэш сброшены. Перезагрузите приложение — устройство переустановит ключи."
            : `Очищено. В кэше осталось: ${remaining < 0 ? "?" : remaining}.`,
        );
      } catch (error) {
        setNote(`Не удалось очистить: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        setBusy(null);
        setPendingClear(null);
      }
    },
    [refresh],
  );

  const share = usage != null && quota ? Math.min(1, usage / quota) : null;

  return (
    <>
      <SettingsStack>
        <SettingsBlock
          label="Занято на устройстве"
          footer={
            quota
              ? `Браузер выделил приложению до ${formatBytes(quota)}.`
              : "Размер хранилища определяет браузер."
          }
        >
          <div className="rounded-2xl bg-surface px-4 py-4">
            <p className="text-[2.125rem] font-semibold leading-none tracking-tight text-foreground tabular-nums">
              {usage == null ? "—" : formatBytes(usage)}
            </p>
            <p className="mt-1.5 text-[0.8125rem] text-muted">
              {messageCount === null
                ? "Подсчёт…"
                : `${messageCount} ${pluralMessages(messageCount)} в кэше`}
            </p>
            {share != null ? (
              <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-tertiary">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-300"
                  style={{ width: `${Math.max(share * 100, 1.5)}%` }}
                />
              </div>
            ) : null}
          </div>
        </SettingsBlock>

        <SettingsGroup
          label="Управление хранилищем"
          footer="Очистка не удаляет переписку: сообщения останутся на сервере и загрузятся снова."
        >
          <SettingsActionRow
            title="Очистить кэш сообщений"
            tone="neutral"
            busy={busy === "messages"}
            disabled={busy !== null}
            onClick={() => void runClear("messages")}
          />
          <SettingsActionRow
            title="Очистить медиа и файлы"
            tone="neutral"
            busy={busy === "browser"}
            disabled={busy !== null}
            onClick={() => void runClear("browser")}
          />
          <SettingsActionRow
            title="Очистить весь кэш"
            subtitle="Ключи шифрования сохранятся"
            tone="neutral"
            busy={busy === "all"}
            disabled={busy !== null}
            onClick={() => void runClear("all")}
          />
        </SettingsGroup>

        <SettingsGroup
          label="Опасные действия"
          footer={
            <SettingsNote tone="warning">
              Переписка перестанет открываться на этом устройстве, пока ключи не вернутся — по
              ключу восстановления или с другого доверенного устройства.
            </SettingsNote>
          }
        >
          <SettingsActionRow
            title="Сбросить ключи шифрования"
            tone="danger"
            busy={busy === "keys"}
            disabled={busy !== null}
            onClick={() => setPendingClear("keys")}
          />
        </SettingsGroup>

        {note ? (
          <p role="status" className="px-5 text-[0.8125rem] leading-snug text-muted">
            {note}
          </p>
        ) : null}
      </SettingsStack>

      <ConfirmSheet
        open={pendingClear === "keys"}
        title="Сбросить ключи шифрования?"
        body="Переписка на этом устройстве перестанет открываться, пока ключи не будут восстановлены."
        confirmLabel="Сбросить ключи"
        busy={busy === "keys"}
        onConfirm={() => void runClear("keys")}
        onCancel={() => setPendingClear(null)}
      />
    </>
  );
}
