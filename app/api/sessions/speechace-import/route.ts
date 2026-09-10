import { createSpeechaceImportSessions } from "@/lib/sessions-service";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/sessions/speechace-import
 * Creates one new session per pasted Speechace placement-report URL, so
 * results can be compared against ours. One bad URL doesn't fail the batch —
 * each URL's outcome is reported individually. Admin-only, gated by
 * middleware.ts.
 *
 * Idempotent: safe to re-submit the same list (e.g. after a large batch got
 * cut off by the function timeout) — already-imported URLs are skipped and
 * partially-imported ones are repaired, see createSpeechaceImportSession.
 */
export async function POST(req: Request) {
  const { urls } = await req.json();
  const trimmed = (Array.isArray(urls) ? urls : [])
    .filter((u): u is string => typeof u === "string")
    .map((u) => u.trim())
    .filter(Boolean);

  if (!trimmed.length) {
    return Response.json({ error: "No report URLs provided" }, { status: 400 });
  }

  const results = await createSpeechaceImportSessions(trimmed);
  return Response.json({ results });
}
