import { getSupabaseServer } from "@/lib/supabase-server";
import { getSessionDetail } from "@/lib/sessions-service";
import { getProvider } from "@/lib/llm/registry";
import { CEFR_SYSTEM_PROMPT, CEFR_PROMPT_VERSION, buildEvaluationUserMessage } from "@/lib/cefr-prompt";
import { computeCompositeCefrScore } from "@/lib/cefr-score";
import type { ConvLang } from "@/lib/conversation-prompts";
import type { PronunciationAvg, CefrResult, EvaluationRow } from "@/lib/types";

/**
 * The live conversation flow (app/api/evaluate/route.ts) calls
 * mistralComplete()/mistralModel() directly, bypassing lib/llm/registry.ts
 * entirely — so a session's evaluation_json has no stored model_id to
 * attribute it to. Keep in sync with lib/llm/registry.ts's "mistral" entry
 * if that route ever stops hardcoding Mistral.
 */
export const LIVE_CONVERSATION_MODEL_ID = "mistral";

/**
 * One model's latest successful CEFR result for a session — unlike reading
 * `evaluations[0]` (just whichever model ran most recently), this isolates a
 * single LLM provider so its score, dimensions, or confidence can be compared
 * head-to-head against another (e.g. Mistral vs. Anthropic).
 */
export function latestEvaluationResult(evaluations: EvaluationRow[], modelId: string): CefrResult | null {
  const latest = evaluations
    .filter((e) => e.model_id === modelId && !e.error && e.result_json)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
  return latest?.result_json ?? null;
}

// Kept in sync with lib/pronunciation-rollup.ts's PENDING_STALE_MS — same
// rationale: a pending row older than this is an orphan from a dead server
// process, not a genuinely long-running request, and must not block retries forever.
const PENDING_STALE_MS = 6 * 60_000;

/**
 * Whether a model's most recent evaluation run is an unresolved pending
 * placeholder (see runCefrEvaluation below) — i.e. a run was launched and
 * hasn't finished yet.
 */
export function isEvalProviderPending(evaluations: EvaluationRow[], modelId: string): boolean {
  const latest = evaluations
    .filter((e) => e.model_id === modelId)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
  return (
    !!latest &&
    !latest.error &&
    !latest.result_json &&
    Date.now() - new Date(latest.created_at).getTime() < PENDING_STALE_MS
  );
}

/**
 * One model's latest overall CEFR score (0-100) for a session — the SAME
 * composite `CefrPanel` displays (LLM score_percent + the audio-pronunciation
 * excellence bonus, see lib/cefr-score.ts), not the raw score_percent alone.
 */
export function globalScoreByModel(evaluations: EvaluationRow[], modelId: string, pronunciationAvg: PronunciationAvg | null): number | null {
  const result = latestEvaluationResult(evaluations, modelId);
  if (!result) return null;
  return computeCompositeCefrScore(result, pronunciationAvg).score;
}

/**
 * Runs a stored session's transcript through one or more LLM providers and
 * persists each result to session_evaluations. Shared by the eval lab's
 * replay route and the session-wide "run full evaluation" batch route.
 */
export async function runCefrEvaluation(sessionId: string, providerIds: string[]): Promise<EvaluationRow[]> {
  const detail = await getSessionDetail(sessionId);
  if (!detail) throw new Error("session not found");

  const userTurns = detail.turns.filter((t) => t.role === "user").map((t) => t.content);
  if (!userTurns.length) throw new Error("No user turns stored for this session");

  const userMessage = buildEvaluationUserMessage(
    detail.session.language as ConvLang,
    userTurns,
    detail.session.pronunciation_scores ?? undefined,
  );

  const supabase = getSupabaseServer();

  return Promise.all(
    providerIds.map(async (providerId) => {
      const startedAt = Date.now();

      // Pending placeholder first (see lib/pronunciation/assess.ts for the
      // same pattern/rationale), finalized in place via update() below.
      const { data: pendingRow, error: pendingError } = await supabase
        .from("session_evaluations")
        .insert({ session_id: sessionId, model_id: providerId, prompt_version: CEFR_PROMPT_VERSION })
        .select("*")
        .single();
      if (pendingError || !pendingRow) {
        throw new Error(pendingError?.message ?? "failed to create pending evaluation row");
      }

      try {
        const provider = getProvider(providerId);
        const text = await provider.complete({
          model: provider.defaultModel,
          system: CEFR_SYSTEM_PROMPT,
          messages: [{ role: "user", content: userMessage }],
          maxTokens: 1500,
          json: true,
        });
        const cleaned = text.replace(/^```json\s*|\s*```$/g, "").trim();
        const resultJson = JSON.parse(cleaned);
        const durationMs = Date.now() - startedAt;

        const { data: row, error: updateError } = await supabase
          .from("session_evaluations")
          .update({ result_json: resultJson, duration_ms: durationMs })
          .eq("id", pendingRow.id)
          .select("*")
          .single();

        if (updateError) throw new Error(updateError.message);
        return row as EvaluationRow;
      } catch (e) {
        const durationMs = Date.now() - startedAt;
        const { data: row } = await supabase
          .from("session_evaluations")
          .update({ error: String(e), duration_ms: durationMs })
          .eq("id", pendingRow.id)
          .select("*")
          .single();
        return (row as EvaluationRow) ?? ({ ...pendingRow, error: String(e) } as EvaluationRow);
      }
    }),
  );
}
