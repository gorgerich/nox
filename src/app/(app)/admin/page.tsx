import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { isAdminRole } from "@/lib/permissions";
import { AdminPanel } from "./AdminPanel";

export default async function AdminPage() {
  const user = await getCurrentUser();

  if (!user || !isAdminRole(user.role)) {
    redirect("/chats");
  }

  return <AdminPanel currentUserId={user.id} currentUserRole={user.role} />;
}
