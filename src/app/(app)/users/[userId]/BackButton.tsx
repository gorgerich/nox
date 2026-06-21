"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

export function BackButton() {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => {
        if (window.history.length > 1) {
          router.back();
          return;
        }

        router.push("/chats");
      }}
      className="touch-target flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-primary transition-smooth hover:bg-primary/10 active:scale-[0.96]"
      aria-label="Назад"
    >
      <ArrowLeft className="h-5 w-5" strokeWidth={2.4} />
    </button>
  );
}
