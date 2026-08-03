import { createUploadSession } from "@/lib/sessions-service";

export const runtime = "nodejs";

/**
 * POST /api/sessions/upload
 * Creates a new session from a single standalone audio file — lets you run
 * the pronunciation lab against any recording, not just one captured live.
 * Gated by middleware.ts (admin cookie required): unlike POST /api/sessions
 * (the live conversation's public save path), this is an admin-tool action.
 */
export async function POST(req: Request) {
  const form = await req.formData();
  try {
    const { id } = await createUploadSession(form);
    return Response.json({ id });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
