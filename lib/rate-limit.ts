/**
 * Per-IP rate limit for the public routes that call paid AI providers
 * (middleware.ts). Deliberately simple: a fixed 10-minute window counted in
 * memory, no external store.
 *
 * Best-effort by design: each server instance keeps its own counts (Vercel
 * runs several, per region), and a new deployment resets them. It stops a
 * script hammering the endpoints from one machine, which is the cost risk;
 * it is not a hard quota. For one, add a rate-limit rule in the Vercel
 * Firewall instead.
 *
 * Sized so real candidates never notice: a full session (7 min max) makes
 * about 100–120 calls across these routes and 1 evaluation; the limits leave
 * room for ~8 simultaneous sessions behind one shared IP (a company or
 * school network).
 */

const WINDOW_MS = 10 * 60 * 1000;

/** Route → budget per IP per window. Routes sharing a group share one count. */
const LIMITS: Record<string, { group: string; max: number }> = {
  "/api/chat": { group: "ai", max: 1000 },
  "/api/transcribe": { group: "ai", max: 1000 },
  "/api/pronunciation": { group: "ai", max: 1000 },
  "/api/assess-transcript": { group: "ai", max: 1000 },
  "/api/classify-topic": { group: "ai", max: 1000 },
  "/api/realtime-token": { group: "ai", max: 1000 },
  "/api/gradium-token": { group: "ai", max: 1000 },
  // The most expensive single call (whole transcript on the large model).
  "/api/evaluate": { group: "evaluate", max: 30 },
};

export const RATE_LIMITED_PATHS = Object.keys(LIMITS);

const counts = new Map<string, { windowStart: number; count: number }>();

/** Seconds until the caller may retry, or null when the request is allowed. */
export function rateLimit(pathname: string, ip: string): number | null {
  const limit = LIMITS[pathname];
  if (!limit) return null;

  const now = Date.now();
  // Keep memory bounded: drop expired windows once the map gets large.
  if (counts.size > 10_000) {
    for (const [key, entry] of counts) if (now - entry.windowStart >= WINDOW_MS) counts.delete(key);
  }

  const key = `${limit.group}:${ip}`;
  const entry = counts.get(key);
  if (!entry || now - entry.windowStart >= WINDOW_MS) {
    counts.set(key, { windowStart: now, count: 1 });
    return null;
  }
  entry.count++;
  if (entry.count <= limit.max) return null;
  return Math.ceil((entry.windowStart + WINDOW_MS - now) / 1000);
}
