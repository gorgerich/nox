import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Безопасность Nox",
  description: "Как Nox защищает сообщения, звонки, устройства и локальные данные.",
};

const principles = [
  {
    title: "Защищено",
    text: "Доступ к профилю, устройствам и восстановлению пароля отделён от содержимого переписок.",
  },
  {
    title: "Зашифровано",
    text: "Новые личные чаты используют ключи устройств: сервер доставляет зашифрованный payload, но не читает его.",
  },
  {
    title: "Прозрачно",
    text: "Nox показывает устройства, статусы доставки, настройки кэша и места, где пользователь сам управляет данными.",
  },
];

const sections = [
  {
    title: "Сообщения",
    text: "Текст и медиа в защищённых чатах шифруются для устройств участников. Если на устройстве нет нужного ключа, Nox честно показывает, что сообщение недоступно, вместо попытки подменить содержимое.",
  },
  {
    title: "Звонки",
    text: "Аудио и видео идут через защищённый WebRTC-канал. Сигналинг нужен для соединения, но разговор не хранится как файл и не становится читаемым для сервера.",
  },
  {
    title: "Устройства",
    text: "Каждое устройство регистрирует отдельный ключ. Доверенное устройство помогает восстановить доступ без раскрытия истории новому устройству.",
  },
  {
    title: "Кэш",
    text: "Локальный кэш ускоряет открытие чатов и хранится на устройстве пользователя. Его можно очистить в разделе «Данные и кэш».",
  },
];

export default function SafetyPage() {
  return (
    <main className="min-h-dvh bg-background px-5 pb-16 pt-[calc(env(safe-area-inset-top,0px)+1rem)] text-foreground">
      <div className="mx-auto max-w-3xl">
        <header className="mb-8 flex items-center justify-between gap-3">
          <Link
            href="/chats"
            className="flex h-10 w-10 items-center justify-center rounded-full border border-border-subtle bg-surface text-primary transition-smooth active:scale-[0.96]"
            aria-label="Назад"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <span className="rounded-full border border-border-subtle bg-surface px-4 py-2 text-xs font-semibold text-muted">
            NOX SAFETY
          </span>
        </header>

        <section className="mb-9">
          <h1 className="max-w-xl text-4xl font-semibold tracking-tight sm:text-5xl">
            Безопасность без лишнего шума.
          </h1>
          <p className="mt-4 max-w-2xl text-base font-medium leading-7 text-muted">
            Nox защищает новые личные переписки и звонки сквозным шифрованием. Групповые чаты пока защищены транспортным шифрованием, но не являются E2EE.
          </p>
        </section>

        <section className="grid gap-3 sm:grid-cols-3">
          {principles.map((item) => (
            <article key={item.title} className="rounded-[1.5rem] border border-border-subtle bg-surface p-4">
              <h2 className="text-sm font-semibold text-primary">{item.title}</h2>
              <p className="mt-2 text-sm font-medium leading-6 text-muted">{item.text}</p>
            </article>
          ))}
        </section>

        <section className="mt-8 overflow-hidden rounded-[1.75rem] border border-border-subtle bg-surface">
          {sections.map((item, index) => (
            <article key={item.title}>
              {index > 0 ? <div className="mx-5 h-px bg-border-subtle/50" /> : null}
              <div className="grid gap-2 p-5 sm:grid-cols-[10rem_1fr] sm:gap-5">
                <h2 className="text-base font-semibold tracking-tight">{item.title}</h2>
                <p className="text-sm font-medium leading-6 text-muted">{item.text}</p>
              </div>
            </article>
          ))}
        </section>

        <section className="mt-8 rounded-[1.75rem] border border-primary/20 bg-primary/10 p-5">
          <h2 className="text-lg font-semibold tracking-tight">Что важно помнить</h2>
          <p className="mt-2 text-sm font-medium leading-6 text-muted">
            Если вы переустановили приложение или вошли с нового устройства без доверенного устройства, часть старых зашифрованных сообщений может остаться недоступной. Это не ошибка: так Nox не даёт серверу стать ключом от вашей переписки.
          </p>
        </section>
      </div>
    </main>
  );
}
