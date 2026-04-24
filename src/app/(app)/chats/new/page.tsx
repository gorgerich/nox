import Link from "next/link";
import { NewChatForm } from "./NewChatForm";

export default async function NewChatPage() {
  return (
    <section className="mx-auto max-w-2xl">
      <Link className="inline-flex min-h-10 items-center text-sm text-neutral-400 transition hover:text-white" href="/chats">
        Назад к чатам
      </Link>

      <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-900 p-5 sm:p-6">
        <div className="mb-6">
          <p className="text-sm font-medium text-emerald-400">Новый чат</p>
          <h1 className="mt-1 text-2xl font-semibold">Найти контакт</h1>
          <p className="mt-2 text-sm leading-6 text-neutral-400">
            Введите точный username пользователя и отправьте запрос на общение.
          </p>
        </div>

        <NewChatForm />
      </div>
    </section>
  );
}
