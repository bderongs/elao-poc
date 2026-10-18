/**
 * Single aggregator over every model a live session calls — the conversation
 * itself, topic tracking, and the 5 capability registries (STT, TTS, ET, EO,
 * CEFR-eval) — the "clean place in code" to see what's live everywhere at
 * once. Every other consumer (the admin system-config page, the per-session
 * providers_json snapshot written at session save) reads through this, not
 * through the 5 registries directly, so the "what's live" view and the
 * "what a session used" view can never drift apart from each other.
 *
 * Each registry's own LIVE_..._ID constant (or, for TTS and EO, a
 * LIVE_..._PROVIDER_BY_LANG map; for STT, lib/realtime-stt-config.ts's
 * REALTIME_STT_PROVIDER_BY_LANG on top of LIVE_STT_PROVIDER_ID) remains the actual switch — this file only
 * reads them, it doesn't decide anything itself.
 */

import type { ConvLang } from "@/lib/conversation-prompts";
import { getProvider as getSttProvider, LIVE_STT_PROVIDER_ID } from "@/lib/stt/registry";
import { REALTIME_STT_ENABLED, REALTIME_STT_PROVIDER_BY_LANG, REALTIME_STT_PROVIDER_LABELS, type RealtimeSttProviderId } from "@/lib/realtime-stt-config";
import { getProvider as getTtsProvider, LIVE_TTS_PROVIDER_BY_LANG } from "@/lib/tts/registry";
import { getProvider as getEtProvider, LIVE_ET_PROVIDER_ID } from "@/lib/et/registry";
import { getProvider as getPronunciationProvider } from "@/lib/pronunciation/registry";
import { LIVE_CONVERSATION_PRONUNCIATION_PROVIDER_BY_LANG } from "@/lib/pronunciation-rollup";
import { getProvider as getLlmProvider } from "@/lib/llm/registry";
import { LIVE_CONVERSATION_MODEL_ID } from "@/lib/llm/live-provider";
import { mistralChatModel, mistralRealtimeTranscribeModel } from "@/lib/mistral";
import { SCORING_RULES } from "@/lib/cefr-score";

const REALTIME_STT_MODEL_LABEL: Record<RealtimeSttProviderId, () => string> = {
  gradium: () => "gradium-asr (default)",
  mistral: mistralRealtimeTranscribeModel,
};

const ALL_LANGUAGES: ConvLang[] = ["en", "fr", "nl-BE", "es", "it", "de"];

export interface ProviderConfig {
  providerId: string;
  providerLabel: string;
  modelLabel: string;
}

export interface CapabilityConfig extends ProviderConfig {
  capability: "CONVERSATION" | "TT" | "STT" | "TTS" | "ET" | "EO" | "CEFR_EVAL";
  capabilityLabel: string;
  /** One line on what the step does and when it runs — shown under the label. */
  description?: string;
  /** STT, TTS and EO only — provider choice varies by language; absent for ET/CEFR_EVAL. */
  perLanguage?: Partial<Record<ConvLang, ProviderConfig>>;
}

export function getSystemConfig(): CapabilityConfig[] {
  const stt = getSttProvider(LIVE_STT_PROVIDER_ID);
  const et = getEtProvider(LIVE_ET_PROVIDER_ID);
  const cefrEval = getLlmProvider(LIVE_CONVERSATION_MODEL_ID);

  // The conversation streams to REALTIME_STT_PROVIDER_BY_LANG's provider and
  // only falls back to the batch provider (LIVE_STT_PROVIDER_ID) for languages
  // with no streaming provider, or on a failed/timed-out streaming turn.
  const sttPerLanguage: Partial<Record<ConvLang, ProviderConfig>> = {};
  for (const lang of ALL_LANGUAGES) {
    const streaming = REALTIME_STT_ENABLED ? REALTIME_STT_PROVIDER_BY_LANG[lang] : null;
    sttPerLanguage[lang] = streaming
      ? {
          providerId: `${streaming}-realtime`,
          providerLabel: REALTIME_STT_PROVIDER_LABELS[streaming],
          modelLabel: `${REALTIME_STT_MODEL_LABEL[streaming]()} (fallback: ${stt.modelLabel})`,
        }
      : { providerId: stt.id, providerLabel: "Voxtral batch — no streaming provider for this language", modelLabel: stt.modelLabel };
  }

  const ttsPerLanguage: Partial<Record<ConvLang, ProviderConfig>> = {};
  for (const lang of ALL_LANGUAGES) {
    const provider = getTtsProvider(LIVE_TTS_PROVIDER_BY_LANG[lang]);
    ttsPerLanguage[lang] = {
      providerId: provider.id,
      providerLabel: provider.label,
      modelLabel: provider.voiceLabel(lang),
    };
  }

  const eoPerLanguage: Partial<Record<ConvLang, ProviderConfig>> = {};
  for (const lang of ALL_LANGUAGES) {
    const provider = getPronunciationProvider(LIVE_CONVERSATION_PRONUNCIATION_PROVIDER_BY_LANG[lang]);
    eoPerLanguage[lang] = {
      providerId: provider.id,
      providerLabel: provider.label,
      modelLabel: provider.modelLabel,
    };
  }

  return [
    {
      // app/api/chat/route.ts — not behind a registry: it calls mistralChatModel() directly.
      capability: "CONVERSATION",
      capabilityLabel: "Examiner conversation",
      description: "Writes every question, follow-up and the closing remark; a reply with no question or a repeated one is regenerated once.",
      providerId: "mistral",
      providerLabel: "Mistral",
      modelLabel: mistralChatModel(),
    },
    {
      // app/api/classify-topic → lib/topic-tracking.ts.
      capability: "TT",
      capabilityLabel: "Topic tracking",
      description: "Tags each question's life domain so the examiner changes subject after two questions on the same one.",
      providerId: "mistral",
      providerLabel: "Mistral",
      modelLabel: mistralChatModel(),
    },
    {
      capability: "STT",
      capabilityLabel: "Speech-to-text (live transcription)",
      description: "Turns each answer into text. Streams while the candidate speaks; the batch model is used when streaming fails, cuts an answer short, or the candidate presses \"J'ai terminé\".",
      providerId: "per-language",
      providerLabel: "Varies by language — see perLanguage",
      modelLabel: "Varies by language — see perLanguage",
      perLanguage: sttPerLanguage,
    },
    {
      capability: "TTS",
      capabilityLabel: "Text-to-speech (examiner's voice)",
      description: "Speaks the examiner's replies, sentence by sentence.",
      // No single global provider for TTS — perLanguage is the real answer;
      // these top-level fields summarize it for callers that just want a label.
      providerId: "per-language",
      providerLabel: "Varies by language — see perLanguage",
      modelLabel: "Varies by language — see perLanguage",
      perLanguage: ttsPerLanguage,
    },
    {
      capability: "ET",
      capabilityLabel: "Per-answer level judge (ET)",
      description: "Rates each answer as handled well or struggled, to raise or lower the next question's level and decide when the session can end. Its verdicts also decide the 'top of the scale' mark (C2 answers rated well).",
      providerId: et.id,
      providerLabel: et.label,
      modelLabel: et.modelLabel,
    },
    {
      capability: "EO",
      capabilityLabel: "Pronunciation assessment (EO)",
      description: "Scores each answer's pronunciation from its audio; the session average feeds the final score.",
      // azure-ensemble (Azure + Deepgram, judged by Mistral) for every
      // language as of 2026-09-09 — see LIVE_CONVERSATION_PRONUNCIATION_PROVIDER_BY_LANG
      // in lib/pronunciation-rollup.ts for why Voxtral was pulled back to an
      // on-demand comparison provider. Kept as a perLanguage table (not
      // collapsed to a single top-level provider) since this capability has
      // varied by language before and likely will again.
      providerId: "per-language",
      providerLabel: "Varies by language — see perLanguage",
      modelLabel: "Varies by language — see perLanguage",
      perLanguage: eoPerLanguage,
    },
    {
      capability: "CEFR_EVAL",
      capabilityLabel: "End-of-session CEFR evaluation",
      description:
        "One call on the whole transcript that rates fluency, vocabulary/grammar and communication and writes the feedback; lib/cefr-score.ts turns those and the pronunciation average into the level and score. Boundary second opinion: " +
        (SCORING_RULES.boundaryCheck === "off" ? "off." : `on (${SCORING_RULES.boundaryCheck}), 4 extra calls on the same model.`),
      providerId: cefrEval.id,
      providerLabel: cefrEval.label,
      modelLabel: cefrEval.modelLabel,
    },
  ];
}
