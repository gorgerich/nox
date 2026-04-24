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

export function getAdminRoleLabel(role: string) {
  if (role === "OWNER") {
    return "Владелец";
  }

  if (role === "ADMIN") {
    return "Администратор";
  }

  return "Участник";
}

