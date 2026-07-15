import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isAdminRole } from "@/lib/permissions";

export async function requireAdminUser() {
  const user = await getCurrentUser();

  if (!user || !isAdminRole(user.role)) {
    return {
      user: null,
      response: NextResponse.json({ error: "Нет доступа." }, { status: 403 }),
    };
  }

  return { user, response: null };
}

export async function requireOwnerUser() {
  const user = await getCurrentUser();

  if (!user || user.role !== "OWNER") {
    return {
      user: null,
      response: NextResponse.json({ error: "Только владелец может менять роли." }, { status: 403 }),
    };
  }

  return { user, response: null };
}

export function canManageUser(
  actor: { id: string; role: "OWNER" | "ADMIN" | "MEMBER" },
  target: { id: string; role: "OWNER" | "ADMIN" | "MEMBER" },
) {
  if (actor.id === target.id) return false;
  if (actor.role === "OWNER") return true;
  return actor.role === "ADMIN" && target.role === "MEMBER";
}

export function getAdminRoleLabel(role: string) {
  if (role === "OWNER") {
    return "Владелец";
  }

  if (role === "ADMIN") {
    return "Администратор";
  }

  return "Участник";
}
