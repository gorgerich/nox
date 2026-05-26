"use client";

import { useCallback, useEffect, useState } from "react";
import {
  countCachedMessages,
  clearCachedMessages,
  clearCryptoKeys,
} from "@/lib/e2ee/indexed-db";

type ClearKind = "messages" | "browser" | "all" | "keys";

async function clearBrowserCaches(): Promise<void> {
  if (typeof caches === "undefined") return;
  const names = await caches.keys();
  await Promise.all(names.map((name) => caches.delete(name)));
}

export function CacheSettings() {
  const [messageCount, setMessageCount] = useState<number | null>(null);
  const [usageMB, setUsageMB] = useState<string | null>(null);
  const [busy, setBusy] = useState<ClearKind | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirmKeys, setConfirmKeys] = useState(false);

  const refresh = useCallback(async () => {
    const count = await countCachedMessages().catch(() => 0);
    setMessageCount(count);
    if (typeof navigator !== "undefined" && navigator.storage?.estimate) {
      try {
        const est = await navigator.storage.estimate();
        setUsageMB(est.usage != null ? (est.usage / 1024 / 1024).toFixed(1) : null);
      } catch {
        setUsageMB(null);
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
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
        if (kind === "keys") {
          setNote("Ключи и кэш сброшены. Перезагрузите приложение — устройство переустановит ключи.");
        } else {
          setNote(`Очищено. Сообщений в кэше осталось: ${remaining < 0 ? "?" : remaining}.`);
        }
      } catch (error) {
        setNote(`Не удалось очистить: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        setBusy(null);
        setConfirmKeys(false);
      }
    },
    [refresh],
  );

  return (
    <section className="card-premium p-4 space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-bold text-foreground">Хранилище и кэш</p>
          <p className="text-xs text-muted mt-0.5">
            {messageCount === null ? "Подсчёт…" : `Сообщений в кэше: ${messageCount}`}
            {usageMB ? ` · ${usageMB} МБ на устройстве` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          className="h-9 px-3 rounded-xl text-[10px] font-black uppercase tracking-widest bg-foreground/5 text-muted hover:text-foreground transition-smooth active:scale-95"
        >
          Обновить
        </button>
      </div>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void runClear("messages")}
          className="h-11 rounded-xl text-xs font-black uppercase tracking-widest bg-foreground/5 text-foreground hover:bg-foreground/10 transition-smooth active:scale-[0.98] disabled:opacity-50"
        >
          {busy === "messages" ? "Очистка…" : "Очистить кэш сообщений"}
        </button>

        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void runClear("browser")}
          className="h-11 rounded-xl text-xs font-black uppercase tracking-widest bg-foreground/5 text-foreground hover:bg-foreground/10 transition-smooth active:scale-[0.98] disabled:opacity-50"
        >
          {busy === "browser" ? "Очистка…" : "Очистить медиа и кэш приложения"}
        </button>

        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void runClear("all")}
          className="h-11 rounded-xl text-xs font-black uppercase tracking-widest bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-smooth active:scale-[0.98] disabled:opacity-50"
        >
          {busy === "all" ? "Очистка…" : "Очистить весь кэш (без ключей)"}
        </button>
      </div>

      {/* Danger zone — wiping E2EE keys */}
      <div className="rounded-xl border border-danger/20 bg-danger/5 p-3 space-y-2">
        <p className="text-[10px] font-black uppercase tracking-widest text-danger">Опасная зона</p>
        <p className="text-xs text-muted">
          Сброс ключей шифрования удалит криптоидентичность этого устройства. Переписка
          перестанет расшифровываться, пока устройство не переустановит ключи.
        </p>
        {confirmKeys ? (
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void runClear("keys")}
              className="flex-1 h-11 rounded-xl text-xs font-black uppercase tracking-widest bg-danger text-white transition-smooth active:scale-[0.98] disabled:opacity-50"
            >
              {busy === "keys" ? "Сброс…" : "Да, сбросить ключи"}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => setConfirmKeys(false)}
              className="h-11 px-4 rounded-xl text-xs font-black uppercase tracking-widest bg-foreground/5 text-muted transition-smooth active:scale-95"
            >
              Отмена
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => setConfirmKeys(true)}
            className="h-11 w-full rounded-xl text-xs font-black uppercase tracking-widest bg-danger/10 text-danger border border-danger/20 hover:bg-danger/20 transition-smooth active:scale-[0.98] disabled:opacity-50"
          >
            Сбросить ключи шифрования
          </button>
        )}
      </div>

      {note ? (
        <p className="text-xs font-semibold text-foreground/80 bg-foreground/5 rounded-xl px-3 py-2">{note}</p>
      ) : null}
    </section>
  );
}
