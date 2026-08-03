import { recomputeSessionRollup } from "@/lib/sessions-service";
import { assessTurn } from "@/lib/pronunciation/assess";

export const runtime = "nodejs";

interface AssessRequest {
  providers: string[];
}

/**
 * POST /api/sessions/:id/turns/:turnId/assess
 * Re-runs one recording through one or more pronunciation providers and
 * persists each result to session_turn_evaluations — the pronunciation
 * lab's replay path, the audio-assessment sibling of
 * POST /api/sessions/:id/evaluate (which replays the transcript through LLM
 * providers). Gated by middleware.ts (admin cookie required), since this
 * triggers paid ASR/LLM calls.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string; turnId: string }> }) {
  const { id: sessionId, turnId } = await params;
  const { providers } = (await req.json()) as AssessRequest;

  if (!providers?.length) {
    return Response.json({ error: "No providers specified" }, { status: 400 });
  }

  try {
    const results = await assessTurn(turnId, providers);
    // Uploaded/imported sessions only: fold the latest run of every turn into
    // the session-level transcript + azure_scores so the existing CEFR eval
    // lab can score the session as a whole. No-op for real conversations.
    await recomputeSessionRollup(sessionId);
    return Response.json({ results });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
