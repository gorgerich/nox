export type PresenceLabel = "в сети" | "Был(а) недавно" | "Был(а) на неделе" | "Был(а) давно";

export function formatUserPresence(params: {
  isOnline: boolean;
  lastSeenAt: string | Date | null | undefined;
}): PresenceLabel {
  if (params.isOnline) {
    return "в сети";
  }

  if (!params.lastSeenAt) {
    return "Был(а) давно";
  }

  const lastSeenTime = new Date(params.lastSeenAt).getTime();
  if (Number.isNaN(lastSeenTime)) {
    return "Был(а) давно";
  }

  const diffMs = Date.now() - lastSeenTime;
  const dayMs = 24 * 60 * 60 * 1000;

  if (diffMs < 3 * dayMs) {
    return "Был(а) недавно";
  }

  if (diffMs < 7 * dayMs) {
    return "Был(а) на неделе";
  }

  return "Был(а) давно";
}
