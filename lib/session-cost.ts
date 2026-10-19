/**
 * Rough per-session cost estimate for the admin system-config page —
 * NOT a billing reconciliation tool. Three inputs go into every number:
 *
 *   1. Vendor list prices, checked on each vendor's own pricing source on
 *      2026-10-19 (see "Vendor pricing" below). Re-check them if a vendor
 *      changes pricing or a live provider / model changes.
 *   2. Average real session (AVG_SESSION) — from the 26 completed live
 *      conversations of 2026-09-19 → 2026-10-19 (sessions table, transcript +
 *      pronunciation_scores + evaluation_json). Re-measure as usage shifts.
 *   3. Prompt sizes, measured from the prompts themselves at import time, so
 *      they can't drift when a prompt is edited. Variable content (history,
 *      evidence, JSON written back) is estimated from AVG_SESSION.
 *
 * Tokens are estimated at ~4 characters each — a standard rough heuristic,
 * not a real tokenizer. Good for comparing steps and spotting the big
 * items, not for reconciling an invoice.
 */

import { buildExaminerPrompt } from "@/lib/examiner-prompt";
import { CEFR_SYSTEM_PROMPT } from "@/lib/cefr-prompt";
import { SYSTEM_PROMPT as ET_SYSTEM_PROMPT } from "@/lib/level-assessment";
import { SYSTEM_PROMPT as TT_SYSTEM_PROMPT } from "@/lib/topic-tracking";
import { JUDGE_SYSTEM as EO_JUDGE_SYSTEM } from "@/lib/pronunciation/providers/azure-ensemble";
import { SYSTEM_PROMPT as VOXTRAL_SYSTEM_PROMPT } from "@/lib/pronunciation/providers/voxtral";
import type { ConvLang } from "@/lib/conversation-prompts";
import type { CefrRung } from "@/lib/cefr-rung";

// ─── Average real session (see file header) ────────────────────────────────

export const AVG_SESSION = {
  userTurns: 6.15,
  /** Examiner messages: opening, one per answer, closing. Each is one conversation call. */
  assistantTurns: 7.31,
  userWordsPerSession: 224.7,
  userCharsPerSession: 1214.5,
  /** What the examiner says — also the characters sent to TTS. */
  assistantCharsPerSession: 542.4,
  userWpm: 144.5,
  /** Average length of a stored evaluation_json. */
  cefrEvalResultChars: 1699,
};

/** Silence streamed to realtime STT around each answer (before speaking + the end-of-turn pause). */
const STREAMED_SILENCE_SECONDS_PER_ANSWER = 3;

const userSpeechMinutes = AVG_SESSION.userWordsPerSession / AVG_SESSION.userWpm;
const streamedMinutes = userSpeechMinutes + (AVG_SESSION.userTurns * STREAMED_SILENCE_SECONDS_PER_ANSWER) / 60;
const userCharsPerTurn = AVG_SESSION.userCharsPerSession / AVG_SESSION.userTurns;
const userWordsPerTurn = AVG_SESSION.userWordsPerSession / AVG_SESSION.userTurns;
const charsPerWord = AVG_SESSION.userCharsPerSession / AVG_SESSION.userWordsPerSession;
const assistantCharsPerTurn = AVG_SESSION.assistantCharsPerSession / AVG_SESSION.assistantTurns;

// ─── Vendor pricing, checked 2026-10-19 ────────────────────────────────────
// Mistral: mistral.ai/pricing and docs.mistral.ai model cards; the -latest
//   aliases resolved with GET /v1/models (large → mistral-large-2512,
//   small → mistral-small-2603, voxtral-mini → voxtral-mini-2602).
// Voxtral transcription: mistral.ai/news/voxtral-transcribe-2.
// Azure: prices.azure.com retail API, region germanywestcentral, pay as you go.
// Deepgram: deepgram.com/pricing, pay as you go.
// Gradium: gradium.ai/pricing (1 TTS character = 1 credit).

const CHARS_PER_TOKEN = 4;

const MISTRAL_TEXT_PRICE_PER_M: Record<string, { in: number; out: number }> = {
  "mistral-large-latest": { in: 0.5, out: 1.5 },
  "mistral-small-latest": { in: 0.15, out: 0.6 },
};
const MISTRAL_TEXT_PRICE_FALLBACK = MISTRAL_TEXT_PRICE_PER_M["mistral-large-latest"];

const MISTRAL_TRANSCRIBE_PER_MIN = 0.003; // voxtral-mini-latest, batch
const MISTRAL_REALTIME_TRANSCRIBE_PER_MIN = 0.006; // voxtral-mini-transcribe-realtime
const MISTRAL_TTS_PER_1K_CHARS = 0.016; // voxtral-mini-tts (registered, not live)

// voxtral-small-latest on /v1/chat/completions (admin comparison provider).
const VOXTRAL_SMALL_AUDIO_INPUT_PER_MIN = 0.004;
const VOXTRAL_SMALL_TEXT_INPUT_PRICE_PER_M = 0.1;
const VOXTRAL_SMALL_OUTPUT_PRICE_PER_M = 0.4;

const AZURE_STT_PER_HOUR = 1.0;
// Not listed pay-as-you-go for germanywestcentral; consistent with its
// committed-tier add-on prices ($0.24/h at 2K hours).
const AZURE_PRONUNCIATION_ASSESSMENT_ADDON_PER_HOUR = 0.3;
const AZURE_NEURAL_TTS_PER_1M_CHARS = 15.0;

const DEEPGRAM_NOVA3_PRERECORDED_PER_MIN = 0.0043;

// Credit price depends on the plan: S plan top-ups are $5 per 100k credits
// ($50/M characters); XS $69/M, M $40/M, L $38/M.
const GRADIUM_TTS_PER_1M_CHARS = 50;

function mistralTextCostUsd(modelLabel: string, inputChars: number, outputChars: number): number {
  const price = MISTRAL_TEXT_PRICE_PER_M[modelLabel] ?? MISTRAL_TEXT_PRICE_FALLBACK;
  return ((inputChars / CHARS_PER_TOKEN) * price.in + (outputChars / CHARS_PER_TOKEN) * price.out) / 1_000_000;
}

const tokens = (chars: number) => Math.round(chars / CHARS_PER_TOKEN).toLocaleString("en-US");

// ─── Prompt sizes, measured from the prompts themselves ────────────────────

const LANGS: ConvLang[] = ["en", "fr", "nl-BE", "es", "it", "de"];
const RUNGS: CefrRung[] = ["A1", "A2", "B1", "B2", "C1", "C2"];
/** The examiner's system prompt varies by language and level — use the average. */
const EXAMINER_SYSTEM_CHARS = (() => {
  const sizes = LANGS.flatMap((language) => RUNGS.map((rung) => buildExaminerPrompt({ language, rung }).system.length));
  return sizes.reduce((a, b) => a + b, 0) / sizes.length;
})();

export interface CostEstimate {
  usdPerSession: number;
  /** One-line human-readable basis, shown in the cost tooltip. */
  note: string;
}

// ─── Estimators, one per capability ────────────────────────────────────────

/** Examiner conversation: one call per examiner message, re-sending the system prompt and the whole history so far. */
export function estimateConversationCostUsd(providerId: string, modelLabel: string): CostEstimate | null {
  if (providerId !== "mistral") return null;
  // History grows linearly over the session, so on average each call carries half of it.
  const avgHistoryChars = (AVG_SESSION.userCharsPerSession + AVG_SESSION.assistantCharsPerSession) / 2;
  const inputChars = EXAMINER_SYSTEM_CHARS + avgHistoryChars;
  const usd = mistralTextCostUsd(modelLabel, inputChars, assistantCharsPerTurn) * AVG_SESSION.assistantTurns;
  return {
    usdPerSession: usd,
    note: `${AVG_SESSION.assistantTurns.toFixed(1)} calls × ~${tokens(inputChars)} tok in (prompt + history) / ~${tokens(assistantCharsPerTurn)} tok out (${modelLabel}). Occasional regenerations not counted.`,
  };
}

/** Topic tracking: one small call per examiner question. */
export function estimateTtCostUsd(providerId: string, modelLabel: string): CostEstimate | null {
  if (providerId !== "mistral") return null;
  const calls = AVG_SESSION.assistantTurns - 1; // the closing remark asks no question
  const inputChars = TT_SYSTEM_PROMPT.length + assistantCharsPerTurn * 2 + userCharsPerTurn; // question + recent exchange
  const outputChars = 25; // {"domain":"..."}
  const usd = mistralTextCostUsd(modelLabel, inputChars, outputChars) * calls;
  return { usdPerSession: usd, note: `${calls.toFixed(1)} calls × ~${tokens(inputChars)} tok in (${modelLabel})` };
}

/** Speech-to-text for ONE language's live provider. */
export function estimateSttCostUsd(providerId: string): CostEstimate | null {
  if (providerId === "mistral-realtime") {
    return {
      usdPerSession: streamedMinutes * MISTRAL_REALTIME_TRANSCRIBE_PER_MIN,
      note: `${streamedMinutes.toFixed(2)} min streamed × $${MISTRAL_REALTIME_TRANSCRIBE_PER_MIN}/min (Mistral realtime). Batch fallbacks ($${MISTRAL_TRANSCRIBE_PER_MIN}/min) not counted.`,
    };
  }
  if (providerId === "voxtral") {
    return {
      usdPerSession: userSpeechMinutes * MISTRAL_TRANSCRIBE_PER_MIN,
      note: `${userSpeechMinutes.toFixed(2)} min user audio × $${MISTRAL_TRANSCRIBE_PER_MIN}/min (Voxtral batch)`,
    };
  }
  return null; // gradium-realtime: wired but off, not priced
}

/** Text-to-speech for ONE language's live provider. */
export function estimateTtsCostUsd(providerId: string): CostEstimate | null {
  const chars = AVG_SESSION.assistantCharsPerSession;
  if (providerId === "gradium") {
    return {
      usdPerSession: (chars / 1_000_000) * GRADIUM_TTS_PER_1M_CHARS,
      note: `${chars.toFixed(0)} chars × $${GRADIUM_TTS_PER_1M_CHARS}/1M chars (Gradium, S-plan top-up rate; $38–69/1M depending on plan)`,
    };
  }
  if (providerId === "azure") {
    return {
      usdPerSession: (chars / 1_000_000) * AZURE_NEURAL_TTS_PER_1M_CHARS,
      note: `${chars.toFixed(0)} chars × $${AZURE_NEURAL_TTS_PER_1M_CHARS}/1M chars (Azure Neural)`,
    };
  }
  if (providerId === "mistral") {
    return {
      usdPerSession: (chars / 1000) * MISTRAL_TTS_PER_1K_CHARS,
      note: `${chars.toFixed(0)} chars × $${MISTRAL_TTS_PER_1K_CHARS}/1K chars (Voxtral TTS)`,
    };
  }
  return null;
}

/** Per-answer level judge: one small call per answer. */
export function estimateEtCostUsd(providerId: string, modelLabel: string): CostEstimate | null {
  if (providerId !== "mistral") return null;
  const wrapperChars = 60; // lib/level-assessment.ts's "Current rung / Question asked / Speaker's answer" template
  const inputChars = ET_SYSTEM_PROMPT.length + wrapperChars + assistantCharsPerTurn + userCharsPerTurn;
  const outputChars = 22; // {"verdict":"struggled"}
  const usd = mistralTextCostUsd(modelLabel, inputChars, outputChars) * AVG_SESSION.userTurns;
  return { usdPerSession: usd, note: `${AVG_SESSION.userTurns.toFixed(1)} calls × ~${tokens(inputChars)} tok in (${modelLabel})` };
}

/** Pronunciation for ONE language's live provider. */
export function estimateEoCostUsd(providerId: string, modelLabel: string): CostEstimate | null {
  if (providerId === "voxtral") {
    // One audio + text call per answer (admin comparison provider).
    const textInputChars = VOXTRAL_SYSTEM_PROMPT.length + 170 + assistantCharsPerTurn;
    const outputChars = userCharsPerTurn + userWordsPerTurn * (20 + charsPerWord) + 100;
    const perCallUsd =
      (userSpeechMinutes / AVG_SESSION.userTurns) * VOXTRAL_SMALL_AUDIO_INPUT_PER_MIN +
      (textInputChars / CHARS_PER_TOKEN / 1_000_000) * VOXTRAL_SMALL_TEXT_INPUT_PRICE_PER_M +
      (outputChars / CHARS_PER_TOKEN / 1_000_000) * VOXTRAL_SMALL_OUTPUT_PRICE_PER_M;
    return {
      usdPerSession: perCallUsd * AVG_SESSION.userTurns,
      note: `${AVG_SESSION.userTurns.toFixed(1)} calls × (audio + ~${tokens(textInputChars)} tok in + ~${tokens(outputChars)} tok out, ${modelLabel})`,
    };
  }

  if (providerId !== "azure-ensemble") return null;

  const deepgramUsd = userSpeechMinutes * DEEPGRAM_NOVA3_PRERECORDED_PER_MIN;
  const azureUsd = (userSpeechMinutes / 60) * (AZURE_STT_PER_HOUR + AZURE_PRONUNCIATION_ASSESSMENT_ADDON_PER_HOUR);
  // Mistral judge, per answer: both transcripts, per-word confidences and
  // acoustic scores in; one small JSON entry per word out.
  const evidenceChars = 150 + userCharsPerTurn * 2 + userWordsPerTurn * (12 + 15);
  const inputChars = EO_JUDGE_SYSTEM.length + evidenceChars;
  const outputChars = userWordsPerTurn * 26 + 100;
  const judgeModel = modelLabel.match(/\+ (\S+) judge/)?.[1] ?? "mistral-large-latest";
  const mistralUsd = mistralTextCostUsd(judgeModel, inputChars, outputChars) * AVG_SESSION.userTurns;

  return {
    usdPerSession: deepgramUsd + azureUsd + mistralUsd,
    note:
      `${userSpeechMinutes.toFixed(2)} min audio × (Deepgram $${DEEPGRAM_NOVA3_PRERECORDED_PER_MIN}/min + Azure $${(AZURE_STT_PER_HOUR + AZURE_PRONUNCIATION_ASSESSMENT_ADDON_PER_HOUR).toFixed(2)}/h)` +
      ` + ${AVG_SESSION.userTurns.toFixed(1)} judge calls × ~${tokens(inputChars)} tok in (${judgeModel})`,
  };
}

/** Final CEFR evaluation: one call on the whole transcript (boundary checks off). */
export function estimateCefrEvalCostUsd(providerId: string, modelLabel: string): CostEstimate | null {
  if (providerId !== "mistral") return null;
  // buildEvaluationUserMessage's wrapper (header, pronunciation section, "[Turn N · Xw]" labels) + the transcript.
  const wrapperChars = 900 + 13 * AVG_SESSION.userTurns;
  const inputChars = CEFR_SYSTEM_PROMPT.length + wrapperChars + AVG_SESSION.userCharsPerSession;
  const outputChars = AVG_SESSION.cefrEvalResultChars;
  return {
    usdPerSession: mistralTextCostUsd(modelLabel, inputChars, outputChars),
    note: `1 call × ~${tokens(inputChars)} tok in / ~${tokens(outputChars)} tok out (${modelLabel})`,
  };
}

export function formatUsd(usd: number): string {
  if (usd < 0.001) return `$${usd.toFixed(5)}`;
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(3)}`;
}
