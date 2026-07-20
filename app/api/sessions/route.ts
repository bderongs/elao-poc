import { createSessionFromForm, listSessions } from "@/lib/sessions-service";

export const runtime = "nodejs";

/**
 * POST /api/sessions — create a session (public; the live conversation UI
 * posts here at the end of a session — see middleware.ts for the carve-out).
 */
export async function POST(req: Request) {
  try {
    const { id } = await createSessionFromForm(await req.formData());
    return Response.json({ id });
  } catch (e) {
    console.error("[sessions] create failed:", e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

/**
 * GET /api/sessions?page=&pageSize= — paginated list.
 * Admin-only, gated by middleware.ts.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const page = parseInt(url.searchParams.get("page") ?? "1", 10);
  const pageSize = parseInt(url.searchParams.get("pageSize") ?? "25", 10);

  try {
    const result = await listSessions({ page, pageSize });
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
