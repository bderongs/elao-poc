/**
 * Single aggregator over the 5 capability registries (STT, TTS, ET, EO,
 * CEFR-eval) — the "clean place in code" to see what's live everywhere at
 * once. Every other consumer (the admin system-config page, the per-session
 * providers_json snapshot written at session save) reads through this, not
 * through the 5 registries directly, so the "what's live" view and the
 * "what a session used" view can never drift apart from each other.
 *
 * Each registry's own LIVE_..._ID constant (or, for TTS, LIVE_TTS_PROVIDER_BY_LANG)
 * remains the actual switch — this file only reads them, it doesn't decide
 * anything itself.
 */

import type { ConvLang } from "@/lib/conversation-prompts";
import { getProvider as getSttProvider, LIVE_STT_PROVIDER_ID } from "@/lib/stt/registry";
import { getProvider as getTtsProvider, LIVE_TTS_PROVIDER_BY_LANG } from "@/lib/tts/registry";
import { getProvider as getEtProvider, LIVE_ET_PROVIDER_ID } from "@/lib/et/registry";
import { getProvider as getPronunciationProvider } from "@/lib/pronunciation/registry";
import { LIVE_CONVERSATION_PRONUNCIATION_PROVIDER_ID } from "@/lib/pronunciation-rollup";
import { getProvider as getLlmProvider } from "@/lib/llm/registry";
import { LIVE_CONVERSATION_MODEL_ID } from "@/lib/llm/live-provider";

const ALL_LANGUAGES: ConvLang[] = ["en", "fr", "nl-BE", "es", "it", "de"];

export interface ProviderConfig {
  providerId: string;
  providerLabel: string;
  modelLabel: string;
}

export interface CapabilityConfig extends ProviderConfig {
  capability: "STT" | "TTS" | "ET" | "EO" | "CEFR_EVAL";
  capabilityLabel: string;
  /** TTS only — provider choice varies by language; absent for the other 4. */
  perLanguage?: Partial<Record<ConvLang, ProviderConfig>>;
}

export function getSystemConfig(): CapabilityConfig[] {
  const stt = getSttProvider(LIVE_STT_PROVIDER_ID);
  const et = getEtProvider(LIVE_ET_PROVIDER_ID);
  const eo = getPronunciationProvider(LIVE_CONVERSATION_PRONUNCIATION_PROVIDER_ID);
  const cefrEval = getLlmProvider(LIVE_CONVERSATION_MODEL_ID);

  const perLanguage: Partial<Record<ConvLang, ProviderConfig>> = {};
  for (const lang of ALL_LANGUAGES) {
    const provider = getTtsProvider(LIVE_TTS_PROVIDER_BY_LANG[lang]);
    perLanguage[lang] = {
      providerId: provider.id,
      providerLabel: provider.label,
      modelLabel: provider.voiceLabel(lang),
    };
  }

  return [
    {
      capability: "STT",
      capabilityLabel: "Speech-to-text (live transcription)",
      providerId: stt.id,
      providerLabel: stt.label,
      modelLabel: stt.modelLabel,
    },
    {
      capability: "TTS",
      capabilityLabel: "Text-to-speech (examiner's voice)",
      // No single global provider for TTS — perLanguage is the real answer;
      // these top-level fields summarize it for callers that just want a label.
      providerId: "per-language",
      providerLabel: "Varies by language — see perLanguage",
      modelLabel: "Varies by language — see perLanguage",
      perLanguage,
    },
    {
      capability: "ET",
      capabilityLabel: "Evaluation Transcription (per-turn pacing judge)",
      providerId: et.id,
      providerLabel: et.label,
      modelLabel: et.modelLabel,
    },
    {
      capability: "EO",
      capabilityLabel: "Evaluation Oral (pronunciation assessment)",
      providerId: eo.id,
      providerLabel: eo.label,
      modelLabel: eo.modelLabel,
    },
    {
      capability: "CEFR_EVAL",
      capabilityLabel: "End-of-session CEFR evaluation",
      providerId: cefrEval.id,
      providerLabel: cefrEval.label,
      modelLabel: cefrEval.modelLabel,
    },
  ];
}
