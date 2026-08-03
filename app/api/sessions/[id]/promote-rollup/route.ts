import { promoteConversationRollup } from "@/lib/sessions-service";

export const runtime = "nodejs";

/**
 * POST /api/sessions/:id/promote-rollup
 * Overwrites a conversation session's headline azure_scores with its latest
 * azure-ensemble pronunciation-lab re-run (see promoteConversationRollup for
 * why this exists and what it deliberately bypasses). No-op-turned-error for
 * anything other than a fully-covered source: 'conversation' session.
 * Gated by middleware.ts (admin cookie required).
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await promoteConversationRollup(id);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
