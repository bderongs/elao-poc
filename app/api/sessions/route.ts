import { createSessionFromForm, listSessions } from "@/lib/sessions-service";
import { getCurrentUser } from "@/lib/current-user";

export const runtime = "nodejs";

/**
 * POST /api/sessions — create a session (public; the live conversation UI
 * posts here at the end of a session — see middleware.ts for the carve-out).
 * If the request carries a valid Supabase session cookie, the new session is
 * attached to that account and its remembered language/rung preference is
 * updated (see createSessionFromForm) — otherwise it's saved anonymously
 * exactly as before, and the post-session ClaimResultsForm remains the way
 * to attach it later.
 */
export async function POST(req: Request) {
  try {
    const user = await getCurrentUser();
    const { id } = await createSessionFromForm(await req.formData(), user?.id ?? null);
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
