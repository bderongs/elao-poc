import { startLiveSession, saveLiveProgress } from "@/lib/sessions-service";
import { getCurrentUser } from "@/lib/current-user";

export const runtime = "nodejs";

/**
 * POST /api/sessions/live  { language } → { id } — creates the 'in_progress'
 * row for a live conversation at its first answer.
 * PATCH /api/sessions/live { id, durationSeconds, turns } — saves progress
 * after each answer. Both are public (see middleware.ts): guests have no
 * account, and the service only ever touches in-progress conversation rows.
 * The final save is still POST /api/sessions, which finalises this row.
 */
export async function POST(req: Request) {
  try {
    const { language } = (await req.json()) as { language?: string };
    const user = await getCurrentUser();
    return Response.json(await startLiveSession(language ?? "en", user?.id ?? null));
  } catch (e) {
    console.error("[sessions/live] start failed:", e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const { id, durationSeconds, turns } = (await req.json()) as {
      id?: string;
      durationSeconds?: number;
      turns?: Array<{ role: string; content: string; pronunciation: unknown | null }>;
    };
    if (!id || !Array.isArray(turns)) return Response.json({ error: "id and turns required" }, { status: 400 });
    const user = await getCurrentUser();
    await saveLiveProgress(id, { durationSeconds: Math.max(0, Math.round(durationSeconds ?? 0)), turns }, user?.id ?? null);
    return Response.json({ ok: true });
  } catch (e) {
    console.error("[sessions/live] progress failed:", e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
