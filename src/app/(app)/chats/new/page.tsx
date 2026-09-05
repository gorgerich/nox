import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { NewChatForm } from "./NewChatForm";

export default async function NewChatPage() {
  return (
    <div className="app-section app-section-compact !pt-[env(safe-area-inset-top,0px)]">
      <header className="nox-detail-header app-section-header !grid">
        <Link 
          className="fast-tap inline-flex h-11 w-11 items-center justify-center rounded-full text-primary transition-colors hover:bg-primary/8"
          href="/chats"
          aria-label="Назад"
        >
          <ArrowLeft className="h-5 w-5" strokeWidth={2.3} />
        </Link>
        <h1 className="nox-detail-title">Добавить контакт</h1>
        <div className="h-11 w-11" />
      </header>

      <NewChatForm />
    </div>
  );
}
