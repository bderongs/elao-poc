import type { AnalysisTranslation, CefrResult } from "@/lib/types";
import type { UiLang } from "@/lib/ui-strings";

/**
 * The feedback to show in an interface language (roadmap L-04): the English
 * original, the French translation (analysis_fr), or one of analysis_i18n.
 * Falls back to the English original when that translation is missing —
 * readable by more candidates than French.
 */
export function analysisFor(result: CefrResult, lang: UiLang): AnalysisTranslation {
  if (lang === "en") return result;
  if (lang === "fr") return result.analysis_fr ?? result;
  return result.analysis_i18n?.[lang] ?? result;
}

/** True when the feedback already exists in this interface language (English always does). */
export function hasAnalysisIn(result: CefrResult, lang: UiLang): boolean {
  if (lang === "en") return true;
  const t = lang === "fr" ? result.analysis_fr : result.analysis_i18n?.[lang];
  // A translation made before the axis feedback existed (re-evaluated session) is redone, so the two match.
  return !!t && (!result.axis_feedback || !!t.axis_feedback);
}
