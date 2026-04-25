import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { AppShellChrome } from "./AppShellChrome";

export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const prisma = getPrisma();
  const incomingRequestCount = await prisma.chatRequest.count({
    where: {
      toUserId: user.id,
      status: "PENDING",
    },
  });

  return (
    <AppShellChrome user={{ role: user.role }} incomingRequestCount={incomingRequestCount}>
      {children}
    </AppShellChrome>
  );
}
