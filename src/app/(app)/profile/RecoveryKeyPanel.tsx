"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getRecoveryKeyStatus,
  restoreRecoveryKey,
  setUpRecoveryKey,
  type RecoveryKeyStatus,
} from "@/lib/e2ee/recovery";
import { SettingsBlock, SettingsGroup, SettingsStack } from "@/components/settings/SettingsGroup";
import {
  SettingsInputRow,
  SettingsNote,
  SettingsPrimaryButton,
  SettingsValueRow,
} from "@/components/settings/SettingsRow";

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
 *
 * Those facts are stated once, in a footnote, rather than in a standing amber
 * panel: the state being described is normal, not a fault.
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
    <SettingsStack>
      <SettingsGroup
        label="Состояние"
        footer={
          configured
            ? unlocked
              ? "Переписка, зашифрованная после создания ключа, восстановится на любом новом устройстве."
              : "Введите кодовую фразу, чтобы вернуть переписку на это устройство."
            : "Браузер может очистить хранилище — тогда ключи устройства пропадут вместе с доступом к переписке. Ключ восстановления возвращает её по кодовой фразе."
        }
      >
        <SettingsValueRow
          title="Ключ восстановления"
          value={configured ? "Настроен" : "Не настроен"}
        />
        {configured ? (
          <SettingsValueRow
            title="На этом устройстве"
            value={unlocked ? "Открыт" : "Не открыт"}
          />
        ) : null}
      </SettingsGroup>

      {unlocked ? null : (
        <>
          <SettingsGroup label={configured ? "Кодовая фраза" : "Новая кодовая фраза"}>
            <SettingsInputRow
              id="recovery-passphrase"
              label="Фраза"
              type="password"
              autoComplete={configured ? "current-password" : "new-password"}
              value={passphrase}
              onChange={setPassphrase}
              placeholder="Не короче 8 символов"
            />
            {configured ? null : (
              <SettingsInputRow
                id="recovery-passphrase-confirm"
                label="Ещё раз"
                type="password"
                autoComplete="new-password"
                value={confirmation}
                onChange={setConfirmation}
                placeholder="Повторите фразу"
              />
            )}
          </SettingsGroup>

          <SettingsBlock>
            <SettingsPrimaryButton onClick={submit} disabled={busy}>
              {busy ? "Подождите…" : configured ? "Открыть на этом устройстве" : "Создать ключ"}
            </SettingsPrimaryButton>
          </SettingsBlock>
        </>
      )}

      {error ? (
        <p role="alert" className="px-5 text-[0.8125rem] text-danger">
          {error}
        </p>
      ) : null}
      {done ? (
        <p role="status" className="px-5 text-[0.8125rem] text-success">
          {done}
        </p>
      ) : null}

      <p className="px-5 text-[0.8125rem] leading-snug text-muted">
        <SettingsNote>
          Фразу невозможно восстановить: сервер хранит только зашифрованный ключ и никогда не видит
          саму фразу. Сообщения, зашифрованные до создания ключа, останутся недоступны — их нельзя
          адресовать ключу, которого тогда не существовало.
        </SettingsNote>
      </p>
    </SettingsStack>
  );
}
