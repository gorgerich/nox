export function normalizeAppFileUrl(value: string | null | undefined, apiPrefix: string) {
  if (!value) return null;
  if (/^(https?:|blob:|data:)/i.test(value)) return value;
  if (value.startsWith(apiPrefix)) return value;
  if (value.startsWith("/")) return value;
  return `${apiPrefix}/${value}`;
}

export function normalizeAvatarUrl(value: string | null | undefined) {
  return normalizeAppFileUrl(value, "/api/avatars");
}
