import { notFound } from "next/navigation";
import { getPrisma } from "@/lib/prisma";

export default async function ProfilePage({ params }: { params: Promise<{ chatId: string }> }) {
  const { chatId } = await params;
  const prisma = getPrisma();

  // Fetch chat members to find the target user (direct chat)
  const chat = await prisma.chat.findUnique({
    where: { id: chatId },
    include: {
      members: {
        include: {
          user: {
            include: { profile: true }
          }
        }
      }
    }
  });

  if (!chat || chat.type !== "DIRECT") {
    notFound();
  }

  return (
    <div className="flex flex-col h-full bg-background p-4">
      <h1 className="text-xl font-bold">Профиль собеседника</h1>
      <p>Chat ID: {chatId}</p>
      {/* Profile implementation to follow */}
    </div>
  );
}
