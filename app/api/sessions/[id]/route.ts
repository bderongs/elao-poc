import { getSessionDetail } from "@/lib/sessions-service";

export const runtime = "nodejs";

/**
 * GET /api/sessions/:id — a session plus its turns and replay evaluations.
 * Admin-only, gated by middleware.ts.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const detail = await getSessionDetail(id);
    if (!detail) return Response.json({ error: "not found" }, { status: 404 });
    return Response.json(detail);
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
