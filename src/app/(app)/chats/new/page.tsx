import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { NewChatForm } from "./NewChatForm";

export default async function NewChatPage() {
  return (
    <div className="app-section !max-w-2xl !pt-[calc(env(safe-area-inset-top,0px)+1rem)]">
      <div className="mb-4">
        <Link 
          className="fast-tap mb-4 inline-flex h-10 w-10 items-center justify-center rounded-full text-primary transition-smooth hover:bg-primary/10 active:scale-[0.96]"
          href="/chats"
          aria-label="Назад"
        >
          <ArrowLeft className="h-6 w-6" strokeWidth={2.3} />
        </Link>
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="nox-page-title">Добавить контакт</h1>
          </div>
        </div>
      </div>

      <NewChatForm />
    </div>
  );
}
