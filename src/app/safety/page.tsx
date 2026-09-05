import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Безопасность Nox",
  description: "Как Nox защищает сообщения, звонки, устройства и локальные данные.",
};

const sections = [
  {
    title: "Личные сообщения",
    text: "В защищённых личных чатах текст и медиа шифруются для устройств участников. Если на устройстве нет нужного ключа, содержимое остаётся недоступным.",
  },
  {
    title: "Групповые чаты",
    text: "Сейчас группы защищены шифрованием соединения, но не являются сквозно зашифрованными. Не отправляйте в группы данные, требующие E2EE.",
  },
  {
    title: "Звонки",
    text: "WebRTC шифрует аудио и видео при передаче. Nox не записывает разговор как медиафайл. Это не заявляется как отдельно проверенное прикладное E2EE.",
  },
  {
    title: "Устройства и ключи",
    text: "У каждого устройства свой ключ. Проверяйте активные сеансы и отзывайте незнакомые устройства в настройках профиля.",
  },
  {
    title: "Локальные данные",
    text: "Кэш ускоряет открытие чатов и хранится на устройстве. Его можно очистить в разделе «Данные и кэш» без удаления контактов.",
  },
] as const;

export default function SafetyPage() {
  return (
    <main className="min-h-dvh bg-background pb-10 text-foreground safe-top">
      <header className="liquid-top-chrome sticky top-0 z-50">
        <div className="nox-detail-header mx-auto w-full max-w-[48rem] px-2">
          <Link
            href="/chats"
            className="fast-tap flex h-11 w-11 items-center justify-center rounded-full text-primary transition-colors hover:bg-primary/8"
            aria-label="Назад"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.4} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className="nox-detail-title">Безопасность</h1>
          <div className="h-11 w-11" />
        </div>
      </header>

      <div className="mx-auto w-full max-w-[48rem] px-4 pt-5">
        <section className="px-1">
          <h2 className="text-[1.75rem] font-semibold tracking-tight">Защита в Nox</h2>
          <p className="mt-2 max-w-2xl text-[0.9375rem] leading-6 text-muted">
            Здесь указано, что защищено сейчас, где остаются ограничения и что зависит от вашего устройства.
          </p>
        </section>

        <section className="mt-6 overflow-hidden rounded-[0.875rem] bg-surface" aria-label="Уровни защиты">
          {sections.map((item, index) => (
            <article key={item.title}>
              {index > 0 ? <div className="ml-4 h-px bg-border-subtle" /> : null}
              <div className="px-4 py-3.5">
                <h3 className="text-[1rem] font-medium text-foreground">{item.title}</h3>
                <p className="mt-1 text-[0.8125rem] leading-5 text-muted">{item.text}</p>
              </div>
            </article>
          ))}
        </section>

        <section className="mt-6 px-1">
          <h2 className="text-[1rem] font-medium">После входа на новом устройстве</h2>
          <p className="mt-1 text-[0.8125rem] leading-5 text-muted">
            Старая зашифрованная переписка откроется только при наличии нужных ключей или доверенного устройства. Недоступное сообщение не означает, что сервер может его расшифровать.
          </p>
          <Link href="/profile" className="mt-3 inline-flex min-h-11 items-center text-[0.9375rem] font-medium text-primary transition-colors hover:text-primary-hover">
            Открыть настройки безопасности
          </Link>
        </section>
      </div>
    </main>
  );
}
