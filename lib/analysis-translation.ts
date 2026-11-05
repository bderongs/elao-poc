/**
 * French version of the end-of-session feedback (strengths, areas to
 * improve, notable errors, summary). The evaluator writes it in English
 * (CEFR_SYSTEM_PROMPT), the candidates and the client read French: one extra
 * call translates it, stamped on the evaluation as `analysis_fr` so every
 * screen that shows the feedback can show it in French.
 *
 * Never fails the evaluation: on any error the result goes out without
 * `analysis_fr` and the screens fall back to the English text.
 *
 * Server-only (lib/mistral.ts).
 */

import { mistralComplete, mistralTranslationModel } from "@/lib/mistral";
import { logServerEvent } from "@/lib/server-log";
import { getSupabaseServer } from "@/lib/supabase-server";
import type { AnalysisTranslation, CefrResult } from "@/lib/types";

export const ANALYSIS_TRANSLATION_SYSTEM_PROMPT = `You translate feedback on a spoken language test into French, for the candidate and their training organisation.

Input: a JSON object with "summary" (string), "strengths", "areas_for_improvement" and "notable_errors" (arrays of strings), written in English.
Output: the same JSON object, same keys, same number of items in each array, in the same order, every text translated into natural, professional French. Address nobody directly: keep the third person ("le candidat", "la candidate") as the original does.

Never translate or change anything between quotes ('…' or "…"): those are the candidate's own words or their correction, in the language being tested. Copy them exactly. Keep CEFR levels (A1, B2+…) and numbers as they are.

Return only the JSON object.`;

const pickStrings = (v: unknown): string[] | null =>
  Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : null;

/** Translates the feedback; null if the call fails or comes back in the wrong shape. */
export async function translateAnalysisToFrench(result: CefrResult, context = "analysis-fr"): Promise<AnalysisTranslation | null> {
  const source = {
    summary: result.summary ?? "",
    strengths: result.strengths ?? [],
    areas_for_improvement: result.areas_for_improvement ?? [],
    notable_errors: result.notable_errors ?? [],
  };
  if (!source.summary && !source.strengths.length && !source.areas_for_improvement.length && !source.notable_errors.length) return null;
  try {
    const text = await mistralComplete({
      model: mistralTranslationModel(),
      system: ANALYSIS_TRANSLATION_SYSTEM_PROMPT,
      messages: [{ role: "user", content: JSON.stringify(source) }],
      maxTokens: 1500,
      json: true,
      context,
    });
    const parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "")) as Record<string, unknown>;
    const out: AnalysisTranslation = {
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      strengths: pickStrings(parsed.strengths) ?? [],
      areas_for_improvement: pickStrings(parsed.areas_for_improvement) ?? [],
      notable_errors: pickStrings(parsed.notable_errors) ?? [],
    };
    // A list that came back shorter or longer can't be shown item for item — keep the English one rather than a partial translation.
    const sameShape = (["strengths", "areas_for_improvement", "notable_errors"] as const).every((k) => out[k].length === source[k].length);
    if (!sameShape || (source.summary && !out.summary)) throw new Error("translation does not match the original's shape");
    return out;
  } catch (e) {
    logServerEvent("analysis_translation_failed", { context, error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

/** The evaluation with `analysis_fr` stamped on it (unchanged if the translation fails or is already there). */
export async function withFrenchAnalysis(result: CefrResult, context?: string): Promise<CefrResult> {
  if (result.analysis_fr) return result;
  const analysis_fr = await translateAnalysisToFrench(result, context);
  return analysis_fr ? { ...result, analysis_fr } : result;
}

/**
 * Backfill for evaluations made before the translation existed: translates
 * the feedback shown on a session page and saves it where the evaluation
 * lives (sessions.evaluation_json for a live session, else its eval-lab row),
 * so it's only translated once. Returns the evaluation as is on any failure.
 */
export async function ensureFrenchAnalysis(params: {
  sessionId: string;
  result: CefrResult;
  /** The session_evaluations row the result came from; omitted = sessions.evaluation_json. */
  evaluationRowId?: string;
}): Promise<CefrResult> {
  const { sessionId, result, evaluationRowId } = params;
  if (result.analysis_fr) return result;
  const translated = await withFrenchAnalysis(result, "analysis-fr-backfill");
  if (!translated.analysis_fr) return result;
  const supabase = getSupabaseServer();
  const { error } = evaluationRowId
    ? await supabase.from("session_evaluations").update({ result_json: translated }).eq("id", evaluationRowId)
    : await supabase.from("sessions").update({ evaluation_json: translated }).eq("id", sessionId);
  if (error) logServerEvent("analysis_translation_save_failed", { sessionId, error: error.message });
  return translated;
}
