import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

export default async function CallsPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="mx-auto max-w-2xl safe-top transition-smooth px-4 pt-12">
      <div className="mb-12 px-2">
        <h1 className="text-4xl font-black tracking-tight text-foreground">Звонки</h1>
        <p className="mt-2 text-sm text-muted/60 font-medium uppercase tracking-widest">Ваша история аудиовызовов</p>
      </div>

      <div className="flex flex-col items-center justify-center py-20 text-center animate-in fade-in zoom-in-95 duration-700">
        <div className="mb-8 flex h-24 w-24 items-center justify-center rounded-[2.5rem] bg-surface-muted border border-border-subtle/50 shadow-inner">
          <svg className="h-10 w-10 text-muted/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
          </svg>
        </div>
        
        <h2 className="text-xl font-bold tracking-tight text-foreground/80">Список звонков пуст</h2>
        <p className="mt-3 max-w-[280px] text-sm leading-relaxed text-muted/50 font-medium">
          Вы можете позвонить любому пользователю прямо из личного чата. История звонков появится в этом разделе позже.
        </p>
      </div>
    </div>
  );
}
