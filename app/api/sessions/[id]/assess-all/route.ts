import { getSessionDetail, recomputeSessionRollup } from "@/lib/sessions-service";
import { assessTurn } from "@/lib/pronunciation/assess";
import { runCefrEvaluation } from "@/lib/cefr-eval";
import type { TurnEvaluationRow, EvaluationRow } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

interface AssessAllRequest {
  pronunciationProviders?: string[];
  evalProviders?: string[];
}

// Pronunciation providers are paid, rate-limited ASR calls — cap how many
// turns are in flight at once instead of firing the whole session at once.
const TURN_CONCURRENCY = 2;

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * POST /api/sessions/:id/assess-all
 * Runs every recorded turn in a session through the chosen pronunciation
 * provider(s) and/or the transcript through the chosen CEFR eval provider(s)
 * in one action, instead of assessing turn-by-turn in the pronunciation lab.
 * Built for comparing an imported Speechace session against our own engines,
 * but works on any session with turns (uploaded or live).
 * Gated by middleware.ts (admin cookie required) — triggers paid ASR/LLM calls.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = await params;
  const { pronunciationProviders = [], evalProviders = [] } = (await req.json()) as AssessAllRequest;

  if (!pronunciationProviders.length && !evalProviders.length) {
    return Response.json({ error: "No providers specified" }, { status: 400 });
  }

  const detail = await getSessionDetail(sessionId);
  if (!detail) return Response.json({ error: "session not found" }, { status: 404 });

  const turnsWithAudio = detail.turns.filter((t) => t.role === "user" && t.audio_url);

  let turnResults: Array<{ turnId: string; evaluations?: TurnEvaluationRow[]; error?: string }> = [];
  if (pronunciationProviders.length) {
    if (!turnsWithAudio.length) {
      return Response.json({ error: "No recorded turns to assess" }, { status: 400 });
    }
    turnResults = await mapWithConcurrency(turnsWithAudio, TURN_CONCURRENCY, async (turn) => {
      try {
        const evaluations = await assessTurn(turn.id, pronunciationProviders);
        return { turnId: turn.id, evaluations };
      } catch (e) {
        return { turnId: turn.id, error: e instanceof Error ? e.message : String(e) };
      }
    });
    await recomputeSessionRollup(sessionId);
  }

  let evalResults: EvaluationRow[] = [];
  if (evalProviders.length) {
    evalResults = await runCefrEvaluation(sessionId, evalProviders);
  }

  return Response.json({ turnResults, evalResults, turnsAssessed: turnsWithAudio.length });
}
