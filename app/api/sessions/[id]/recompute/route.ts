import { recomputeSessionRollup } from "@/lib/sessions-service";

export const runtime = "nodejs";

/**
 * POST /api/sessions/:id/recompute
 * Re-derives an uploaded session's transcript + pronunciation_scores from whatever
 * pronunciation-lab evaluations already exist, without re-running any
 * provider. Needed for sessions that were assessed before the automatic
 * recompute-after-assess wiring existed, or whenever the rollup otherwise
 * fell out of sync with the underlying evaluations. No-op for
 * source: 'conversation' sessions (see recomputeSessionRollup).
 * Gated by middleware.ts (admin cookie required).
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await recomputeSessionRollup(id);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
