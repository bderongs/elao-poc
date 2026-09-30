import type { ConvLang } from "@/lib/conversation-prompts";

/**
 * Single source of truth for whether the client streams audio to a realtime
 * STT endpoint instead of waiting for the user to finish and POSTing a batch
 * clip to /api/transcribe. Same "the constant IS the switch" pattern as
 * lib/stt/registry.ts's LIVE_STT_PROVIDER_ID — flip this to false to fall
 * back to the batch path everywhere at once, no other code changes needed
 * (app/page.tsx already falls back automatically on any realtime
 * failure/timeout regardless of this flag).
 */
export const REALTIME_STT_ENABLED = true;

export type RealtimeSttProviderId = "gradium" | "mistral";

/**
 * Which streaming provider each language uses; null = no streaming, every
 * turn goes through the batch path (Voxtral, language-tagged).
 *
 * Mistral's realtime endpoint takes no language parameter, so low-level
 * speakers got transcribed in the wrong language (2026-09-24 beta: DE/NL/FR
 * transcripts "à côté de la plaque"). Gradium's does (`json_config.language`)
 * but only covers en/fr/de/es — nl-BE and it go to batch Voxtral, which does
 * get the language, at the cost of ~1 s more wait per answer.
 *
 * 2026-09-30: off Gradium. Re-transcribing a real EN session's stored turns,
 * Gradium streaming made ~9 meaning-changing errors ("juggernauts" for
 * "diagonals", "front" for "different", "I am even embarrassed" for "I live
 * in Paris") vs ~3 for Voxtral batch — and those errors dragged both the
 * pronunciation average and the CEFR judge down. Gradium stays wired; set a
 * language back to "gradium" once an offline test on stored turns shows it
 * matching Voxtral (check turn-onset clipping first).
 *
 * Default is now Mistral realtime for EVERY language (speed over the missing
 * language hint, Baptiste's call 2026-09-30). To go back to no streaming:
 *   - everywhere at once → REALTIME_STT_ENABLED = false (above);
 *   - one language (e.g. fr/de/nl-BE, where the missing language hurt the
 *     2026-09-24 beta) → set it to null below.
 */
export const REALTIME_STT_PROVIDER_BY_LANG: Record<ConvLang, RealtimeSttProviderId | null> = {
  en: "mistral",
  fr: "mistral",
  de: "mistral",
  es: "mistral",
  "nl-BE": "mistral",
  it: "mistral",
};

/** Admin/snapshot labels (lib/system-config.ts) for each streaming provider. */
export const REALTIME_STT_PROVIDER_LABELS: Record<RealtimeSttProviderId, string> = {
  gradium: "Gradium streaming ASR (EU) — Voxtral batch fallback",
  mistral: "Mistral realtime (Voxtral) — Voxtral batch fallback",
};
