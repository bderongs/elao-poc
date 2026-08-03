import { logServerEvent } from "@/lib/server-log";

export const runtime = "nodejs";

/**
 * Best-effort sink for client-side failures that would otherwise only ever
 * show up as a console.warn in someone's browser DevTools — e.g. the WAV
 * conversion in lib/audio-wav.ts failing silently and falling back to raw
 * audio. Writes into the same logs/server-*.log as every server-side event,
 * so these are diagnosable after the fact without needing a live repro.
 * Public (no admin gate) — called from the public live conversation page.
 */
export async function POST(req: Request) {
  let body: { event?: unknown; data?: unknown };
  try {
    body = await req.json();
  } catch {
    return new Response("invalid JSON", { status: 400 });
  }

  const event = typeof body.event === "string" ? body.event.slice(0, 100) : "client_unknown";
  const data = body.data && typeof body.data === "object" ? (body.data as Record<string, unknown>) : {};

  // Bound the payload — this is a public, unauthenticated endpoint, so never
  // let a caller write unbounded data into the log file.
  const bounded: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data).slice(0, 20)) {
    bounded[key.slice(0, 100)] = typeof value === "string" ? value.slice(0, 500) : value;
  }

  logServerEvent(`client_${event}`, bounded);
  return new Response(null, { status: 204 });
}
