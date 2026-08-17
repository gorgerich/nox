"use client";

import { SettingsGroup, SettingsStack } from "@/components/settings/SettingsGroup";
import { SettingsNote, SettingsToggleRow, SettingsValueRow } from "@/components/settings/SettingsRow";
import type { PushStatus } from "@/hooks/usePushNotifications";

/**
 * Push notifications.
 *
 * There is exactly one switch here because the backend supports exactly one
 * thing: a device is subscribed or it is not. Per-event categories and preview
 * options would be controls that look real and change nothing, so they are
 * absent rather than disabled.
 *
 * What the notification contains is stated plainly instead: the server sends
 * the sender's name and a fixed line, because it cannot read the message.
 */
export function NotificationsPanel({
  status,
  error,
  isSubscribed,
  onSubscribe,
  onUnsubscribe,
}: {
  status: PushStatus;
  error: string | null;
  isSubscribed: boolean;
  onSubscribe: () => void;
  onUnsubscribe: () => void;
}) {
  const unsupported = status === "unsupported";
  const denied = status === "denied";

  return (
    <SettingsStack>
      <SettingsGroup
        label="Уведомления"
        footer={
          denied ? (
            <SettingsNote tone="warning">
              Уведомления отключены в настройках браузера или системы. Разрешите их для этого сайта,
              затем вернитесь сюда.
            </SettingsNote>
          ) : unsupported ? (
            <SettingsNote>
              Эта среда не поддерживает push. Откройте Nox в браузере или установите приложение с
              экрана «Домой».
            </SettingsNote>
          ) : (
            "Приходят, только когда приложение закрыто или чат не открыт. Отключённые чаты не присылают уведомлений."
          )
        }
      >
        <SettingsToggleRow
          title="Push-уведомления"
          checked={isSubscribed}
          disabled={unsupported || denied || status === "loading"}
          onChange={(next) => (next ? onSubscribe() : onUnsubscribe())}
        />
      </SettingsGroup>

      <SettingsGroup
        label="Что видно в уведомлении"
        footer="Текст сообщения не показывается: он зашифрован, и сервер, который отправляет уведомление, его не видит."
      >
        <SettingsValueRow title="Имя отправителя" value="Показывается" />
        <SettingsValueRow title="Текст сообщения" value="Скрыт" />
      </SettingsGroup>

      {error ? (
        <p role="alert" className="px-5 text-[0.8125rem] text-danger">{error}</p>
      ) : null}
    </SettingsStack>
  );
}
