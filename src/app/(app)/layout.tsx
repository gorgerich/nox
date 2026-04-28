import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { AppShellChrome } from "./AppShellChrome";
import { CallProvider } from "./calls/CallProvider";
import { CallOverlay } from "./calls/CallOverlay";
import { E2EEInitializer } from "@/lib/e2ee/E2EEInitializer";
import { AccountRecoveryListener } from "./AccountRecoveryListener";

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
    <CallProvider>
      <E2EEInitializer userId={user.id} />
      <AccountRecoveryListener />
      <AppShellChrome user={{ role: user.role }} incomingRequestCount={incomingRequestCount}>
        {children}
      </AppShellChrome>
      <CallOverlay />
    </CallProvider>
  );
}
