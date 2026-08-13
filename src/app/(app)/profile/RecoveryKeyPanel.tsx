"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getRecoveryKeyStatus,
  restoreRecoveryKey,
  setUpRecoveryKey,
  type RecoveryKeyStatus,
} from "@/lib/e2ee/recovery";

/**
 * Setting up and unlocking the account recovery key.
 *
 * The copy here is doing real work, so it is written to be true rather than
 * reassuring. Two facts users must not learn the hard way:
 *
 *   - the passphrase cannot be recovered, because there is deliberately no
 *     operator-side path to open the key;
 *   - messages sealed before this key existed stay unreadable, because nothing
 *     can address an envelope to a key that did not exist at the time.
 */
export function RecoveryKeyPanel({ userId }: { userId: string }) {
  const [status, setStatus] = useState<RecoveryKeyStatus | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // Resolved through a callback rather than awaited in the effect body: the
  // status is a fetch, and setting state straight after an await inside an
  // effect is the cascade the compiler warns about.
  const refresh = useCallback(() => {
    return getRecoveryKeyStatus(userId)
      .then((next) => setStatus(next))
      .catch(() => setStatus(null));
  }, [userId]);

  useEffect(() => {
    let cancelled = false;
    getRecoveryKeyStatus(userId)
      .then((next) => { if (!cancelled) setStatus(next); })
      .catch(() => { if (!cancelled) setStatus(null); });
    return () => { cancelled = true; };
  }, [userId]);

  const submit = useCallback(async () => {
    setError(null);
    setDone(null);
    if (passphrase.length < 8) {
      setError("Кодовая фраза должна быть не короче 8 символов.");
      return;
    }
    const restoring = Boolean(status?.configured);
    if (!restoring && passphrase !== confirmation) {
      setError("Фразы не совпадают.");
      return;
    }
    setBusy(true);
    try {
      if (restoring) {
        await restoreRecoveryKey(userId, passphrase);
        setDone("Ключ восстановлен на этом устройстве. Переписка снова читается.");
      } else {
        await setUpRecoveryKey(userId, passphrase);
        setDone("Ключ создан. Запишите фразу — восстановить её невозможно.");
      }
      setPassphrase("");
      setConfirmation("");
      await refresh();
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : "";
      setError(
        code === "WRONG_PASSPHRASE_OR_CORRUPT_BACKUP"
          ? "Фраза не подошла."
          : code === "NO_RECOVERY_KEY"
            ? "Для этого аккаунта ключ ещё не создан."
            : "Не удалось выполнить операцию. Попробуйте ещё раз.",
      );
    } finally {
      setBusy(false);
    }
  }, [passphrase, confirmation, status?.configured, userId, refresh]);

  const configured = Boolean(status?.configured);
  const unlocked = Boolean(status?.unlockedHere);

  return (
    <section className="space-y-3 rounded-2xl border border-border-subtle bg-surface p-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground">Ключ восстановления</h2>
        <p className="mt-1 text-xs leading-snug text-muted">
          {configured
            ? unlocked
              ? "Ключ создан и открыт на этом устройстве. Переписка, зашифрованная после его создания, восстановится на любом новом устройстве."
              : "Ключ создан, но на этом устройстве не открыт. Введите кодовую фразу, чтобы вернуть переписку."
            : "Браузер может очистить хранилище — тогда ключи устройства пропадут, и переписка перестанет открываться. Ключ восстановления возвращает её по кодовой фразе."}
        </p>
      </div>

      {unlocked ? null : (
        <div className="space-y-2">
          <label htmlFor="recovery-passphrase" className="ml-1 text-xs font-medium text-muted">
            Кодовая фраза
          </label>
          <input
            id="recovery-passphrase"
            className="input-nox h-12"
            type="password"
            autoComplete={configured ? "current-password" : "new-password"}
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
            placeholder="Не короче 8 символов"
          />
          {configured ? null : (
            <>
              <label htmlFor="recovery-passphrase-confirm" className="ml-1 text-xs font-medium text-muted">
                Повторите фразу
              </label>
              <input
                id="recovery-passphrase-confirm"
                className="input-nox h-12"
                type="password"
                autoComplete="new-password"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                placeholder="Ещё раз"
              />
            </>
          )}

          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="h-11 w-full rounded-full bg-primary text-sm font-semibold text-primary-foreground transition-smooth active:scale-[0.96] disabled:opacity-50"
          >
            {busy ? "Подождите…" : configured ? "Открыть на этом устройстве" : "Создать ключ"}
          </button>
        </div>
      )}

      {error ? (
        <p role="alert" className="text-xs font-semibold text-danger">
          {error}
        </p>
      ) : null}
      {done ? (
        <p role="status" className="text-xs font-semibold text-success">
          {done}
        </p>
      ) : null}

      <p className="text-[11px] leading-snug text-muted">
        Фразу невозможно восстановить: сервер хранит только зашифрованный ключ и никогда не видит саму
        фразу. Сообщения, зашифрованные до создания ключа, останутся недоступны — их нельзя адресовать
        ключу, которого тогда не существовало.
      </p>
    </section>
  );
}
