import Link from "next/link";
import { NewChatForm } from "./NewChatForm";

export default async function NewChatPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-8 px-2">
        <Link 
          className="mb-4 inline-flex items-center text-xs font-bold uppercase tracking-widest text-muted transition hover:text-foreground" 
          href="/chats"
        >
          ← Назад
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">Новый чат</h1>
        <p className="mt-1 text-sm text-muted">Введите username пользователя для поиска.</p>
      </div>

      <div className="rounded-2xl bg-background p-2">
        <NewChatForm />
      </div>
    </div>
  );
}
