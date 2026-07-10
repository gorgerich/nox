type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, RateLimitEntry>();
let lastCleanupAt = 0;

function getClientAddress(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}

export function checkRateLimit(
  request: Request,
  scope: string,
  options: { limit: number; windowMs: number },
) {
  const now = Date.now();

  if (now - lastCleanupAt > 60_000) {
    lastCleanupAt = now;
    for (const [key, entry] of buckets) {
      if (entry.resetAt <= now) buckets.delete(key);
    }
  }

  const key = `${scope}:${getClientAddress(request)}`;
  const current = buckets.get(key);
  const entry = !current || current.resetAt <= now
    ? { count: 0, resetAt: now + options.windowMs }
    : current;

  entry.count += 1;
  buckets.set(key, entry);

  return {
    allowed: entry.count <= options.limit,
    retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
  };
}
