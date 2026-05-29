import Link from "next/link";
import { ArrowLeft, UserPlus } from "lucide-react";
import { NewChatForm } from "./NewChatForm";

export default async function NewChatPage() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-4 pb-[calc(env(safe-area-inset-bottom,0px)+2rem)] pt-[calc(env(safe-area-inset-top,0px)+1rem)]">
      <div className="mb-5">
        <Link 
          className="fast-tap mb-5 inline-flex h-10 w-10 items-center justify-center rounded-full text-primary transition-smooth hover:bg-primary/10 active:scale-95"
          href="/chats"
          aria-label="Назад"
        >
          <ArrowLeft className="h-6 w-6" strokeWidth={2.3} />
        </Link>
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-[2rem] font-bold leading-none tracking-tight">Добавить контакт</h1>
            <p className="mt-2 text-[15px] leading-5 text-muted">Найдите пользователя по username и отправьте запрос.</p>
          </div>
          <div className="mb-1 flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <UserPlus className="h-6 w-6" strokeWidth={2.2} />
          </div>
        </div>
      </div>

      <NewChatForm />
    </div>
  );
}
