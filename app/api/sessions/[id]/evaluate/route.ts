import { runCefrEvaluation } from "@/lib/cefr-eval";

export const runtime = "nodejs";

interface EvaluateRequest {
  providers: string[];
}

/**
 * POST /api/sessions/:id/evaluate
 * Re-runs a stored session's transcript through one or more LLM providers
 * and persists each result to session_evaluations — the eval lab's replay
 * path, separate from the live in-session /api/evaluate call.
 * Gated by middleware.ts (admin cookie required), since this triggers paid
 * LLM calls and returns transcript data.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = await params;
  const { providers } = (await req.json()) as EvaluateRequest;

  if (!providers?.length) {
    return Response.json({ error: "No providers specified" }, { status: 400 });
  }

  try {
    const results = await runCefrEvaluation(sessionId, providers);
    return Response.json({ results });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
