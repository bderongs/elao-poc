/**
 * The end-of-session feedback (strengths, areas to improve, notable errors,
 * summary) in the candidate's interface language. The evaluator writes it in
 * English (CEFR_SYSTEM_PROMPT); one extra call per language translates it.
 *
 * - French is always produced (`analysis_fr`): the client and the admin read
 *   French whatever the candidate's interface.
 * - nl / es / it / de go in `analysis_i18n` (roadmap L-04), for the session's
 *   interface language at evaluation time, or on first view in another one.
 * - English is the original.
 *
 * Never fails the evaluation: on any error the result goes out without that
 * translation and the screens fall back to the English text
 * (lib/analysis-pick.ts).
 *
 * Server-only (lib/mistral.ts).
 */

import { mistralComplete, mistralTranslationModel } from "@/lib/mistral";
import { logServerEvent } from "@/lib/server-log";
import { getSupabaseServer } from "@/lib/supabase-server";
import { hasAnalysisIn } from "@/lib/analysis-pick";
import type { AnalysisTranslation, CefrResult } from "@/lib/types";
import type { UiLang } from "@/lib/ui-strings";

type TargetLang = Exclude<UiLang, "en">;

/** Target language name, and the form the original's neutral "the candidate" takes in it. */
const TARGET: Record<TargetLang, { name: string; thirdPerson: string }> = {
  fr: { name: "French", thirdPerson: '"le candidat"' },
  nl: { name: "Dutch (standard Dutch, understood in Belgium and the Netherlands)", thirdPerson: '"de kandidaat"' },
  es: { name: "Spanish", thirdPerson: '"el candidato"' },
  it: { name: "Italian", thirdPerson: '"il candidato"' },
  de: { name: "German", thirdPerson: '"der Kandidat"' },
};

export function analysisTranslationSystemPrompt(lang: TargetLang): string {
  const { name, thirdPerson } = TARGET[lang];
  return `You translate feedback on a spoken language test into ${name}, for the candidate and their training organisation.

Input: a JSON object with "summary" (string), "strengths", "areas_for_improvement" and "notable_errors" (arrays of strings), written in English.
Output: the same JSON object, same keys, same number of items in each array, in the same order, every text translated into natural, professional ${name}. Address nobody directly: keep the third person as the original does. "The candidate" becomes ${thirdPerson} (use the feminine form only if the original says "she"); never write two forms side by side.

Tokens like ⟦1⟧, ⟦2⟧ stand for the candidate's own words, kept aside: copy every token exactly once, unchanged, where it belongs in the sentence, and add nothing next to it — no translation, no explanation. Keep CEFR levels (A1, B2+…) and numbers as they are.

Return only the JSON object.`;
}

/** Kept for callers and logs that refer to the French prompt. */
export const ANALYSIS_TRANSLATION_SYSTEM_PROMPT = analysisTranslationSystemPrompt("fr");

const pickStrings = (v: unknown): string[] | null =>
  Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : null;

/**
 * Quoted passages ('…', "…", ‘…’, “…”) are the candidate's words or their
 * correction, in the tested language — never to be translated. They are
 * swapped for ⟦n⟧ tokens before the call and put back after, so the model
 * never sees them (asking it not to translate them was not reliable). An
 * opening quote must follow a start, space or bracket and a closing one
 * must precede a space, punctuation or end, so apostrophes inside words
 * ("candidate's", "don't") are left alone.
 */
const QUOTED = /(^|[\s(\[→:–—-])(['"‘“])([^'"‘’“”\n]+?)(['"’”])(?=[\s.,;:!?)\]→–—-]|$)/g;

export function protectQuotes(text: string, kept: string[]): string {
  return text.replace(QUOTED, (_m, before: string, open: string, inner: string, close: string) => {
    kept.push(`${open}${inner}${close}`);
    return `${before}⟦${kept.length}⟧`;
  });
}

/** Puts the quoted passages back; null if a token went missing or appears twice. */
export function restoreQuotes(text: string, kept: string[], seen: Set<number>): string | null {
  let ok = true;
  const out = text.replace(/⟦(\d+)⟧/g, (_m, n: string) => {
    const i = Number(n);
    if (!kept[i - 1] || seen.has(i)) ok = false;
    seen.add(i);
    return kept[i - 1] ?? "";
  });
  return ok ? out : null;
}

/** Translates the feedback into `lang`; null if the call fails or comes back in the wrong shape. */
export async function translateAnalysis(result: CefrResult, lang: TargetLang, context = `analysis-${lang}`): Promise<AnalysisTranslation | null> {
  const kept: string[] = [];
  const protect = (t: string) => protectQuotes(t, kept);
  const source = {
    summary: protect(result.summary ?? ""),
    strengths: (result.strengths ?? []).map(protect),
    areas_for_improvement: (result.areas_for_improvement ?? []).map(protect),
    notable_errors: (result.notable_errors ?? []).map(protect),
  };
  if (!source.summary && !source.strengths.length && !source.areas_for_improvement.length && !source.notable_errors.length) return null;
  // One retry: a list split or merged now and then (seen on Spanish), and a second call usually comes back whole.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const text = await mistralComplete({
        model: mistralTranslationModel(),
        system: analysisTranslationSystemPrompt(lang),
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
      // Every quoted passage back in place, exactly once.
      const seen = new Set<number>();
      const restore = (t: string) => {
        const r = restoreQuotes(t, kept, seen);
        if (r === null) throw new Error("a quoted passage was lost or duplicated");
        return r;
      };
      const restored: AnalysisTranslation = {
        summary: restore(out.summary),
        strengths: out.strengths.map(restore),
        areas_for_improvement: out.areas_for_improvement.map(restore),
        notable_errors: out.notable_errors.map(restore),
      };
      if (seen.size !== kept.length) throw new Error("a quoted passage was lost");
      return restored;
    } catch (e) {
      logServerEvent("analysis_translation_failed", { context, lang, attempt, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return null;
}

export function translateAnalysisToFrench(result: CefrResult, context = "analysis-fr"): Promise<AnalysisTranslation | null> {
  return translateAnalysis(result, "fr", context);
}

/** The evaluation with the feedback in `lang` stamped on it (unchanged if already there, if `lang` is English, or if the translation fails). */
export async function withAnalysisIn(result: CefrResult, lang: UiLang, context?: string): Promise<CefrResult> {
  if (lang === "en" || hasAnalysisIn(result, lang)) return result;
  const translated = await translateAnalysis(result, lang, context ?? `analysis-${lang}`);
  if (!translated) return result;
  return lang === "fr"
    ? { ...result, analysis_fr: translated }
    : { ...result, analysis_i18n: { ...result.analysis_i18n, [lang]: translated } };
}

/** The evaluation with `analysis_fr` stamped on it (unchanged if the translation fails or is already there). */
export function withFrenchAnalysis(result: CefrResult, context?: string): Promise<CefrResult> {
  return withAnalysisIn(result, "fr", context);
}

/**
 * French (always) and the candidate's interface language, translated in
 * parallel — what a fresh evaluation needs.
 */
export async function withAnalysesFor(result: CefrResult, uiLang: UiLang, context = "cefr-eval"): Promise<CefrResult> {
  const [fr, other] = await Promise.all([
    hasAnalysisIn(result, "fr") ? null : translateAnalysis(result, "fr", `${context}-fr`),
    uiLang === "en" || uiLang === "fr" || hasAnalysisIn(result, uiLang) ? null : translateAnalysis(result, uiLang, `${context}-${uiLang}`),
  ]);
  let out = result;
  if (fr) out = { ...out, analysis_fr: fr };
  if (other && uiLang !== "en" && uiLang !== "fr") out = { ...out, analysis_i18n: { ...out.analysis_i18n, [uiLang]: other } };
  return out;
}

/**
 * Backfill on a session page: translates the feedback into the languages
 * the page needs (French always, plus `lang`) and saves it where the
 * evaluation lives (sessions.evaluation_json for a live session, else its
 * eval-lab row), so each language is translated once. Returns the
 * evaluation as is on any failure.
 */
export async function ensureAnalysis(params: {
  sessionId: string;
  result: CefrResult;
  /** The session_evaluations row the result came from; omitted = sessions.evaluation_json. */
  evaluationRowId?: string;
  /** The page's interface language (default: French only). */
  lang?: UiLang;
}): Promise<CefrResult> {
  const { sessionId, result, evaluationRowId, lang = "fr" } = params;
  if (hasAnalysisIn(result, "fr") && hasAnalysisIn(result, lang)) return result;
  const translated = await withAnalysesFor(result, lang, "analysis-backfill");
  if (translated === result) return result;
  const supabase = getSupabaseServer();
  const { error } = evaluationRowId
    ? await supabase.from("session_evaluations").update({ result_json: translated }).eq("id", evaluationRowId)
    : await supabase.from("sessions").update({ evaluation_json: translated }).eq("id", sessionId);
  if (error) logServerEvent("analysis_translation_save_failed", { sessionId, error: error.message });
  return translated;
}

/** French-only backfill, as before (admin pages). */
export function ensureFrenchAnalysis(params: { sessionId: string; result: CefrResult; evaluationRowId?: string }): Promise<CefrResult> {
  return ensureAnalysis({ ...params, lang: "fr" });
}
