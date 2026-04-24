import { getPrisma } from "@/lib/prisma";

export type UserRole = "OWNER" | "ADMIN" | "MEMBER";
export type UserStatus = "PENDING" | "ACTIVE" | "BLOCKED" | "REVOKED";

export function isAdminRole(role: UserRole) {
  return role === "OWNER" || role === "ADMIN";
}

export function canUseApp(user: { role: UserRole; status: UserStatus }, emergencyLocked: boolean) {
  if (user.status !== "ACTIVE") {
    return false;
  }

  if (emergencyLocked && !isAdminRole(user.role)) {
    return false;
  }

  return true;
}

export async function isEmergencyLocked() {
  const prisma = getPrisma();
  const setting = await prisma.systemSetting.findUnique({
    where: { key: "emergency_lock" },
    select: { value: true },
  });

  return setting?.value === "true";
}
