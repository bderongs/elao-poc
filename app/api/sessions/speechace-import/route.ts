import { createSpeechaceImportSession } from "@/lib/sessions-service";

export const runtime = "nodejs";

/**
 * POST /api/sessions/speechace-import
 * Creates a new session from a pasted Speechace placement-report URL, so its
 * results can be compared against ours. Admin-only, gated by middleware.ts.
 */
export async function POST(req: Request) {
  const { url } = await req.json();
  if (typeof url !== "string" || !url.trim()) {
    return Response.json({ error: "Missing report URL" }, { status: 400 });
  }
  try {
    const { id } = await createSpeechaceImportSession(url.trim());
    return Response.json({ id });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
