import { appendTurn } from "@/lib/sessions-service";

export const runtime = "nodejs";

/**
 * POST /api/sessions/:id/turns
 * Appends another recording to an existing session — "add a recording if we
 * have one", reusing the same upload path as POST /api/sessions/upload.
 * Gated by middleware.ts (admin cookie required).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = await params;
  const form = await req.formData();
  try {
    const turn = await appendTurn(sessionId, form);
    return Response.json(turn);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
