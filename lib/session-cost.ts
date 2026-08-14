/**
 * Rough per-session cost estimate for the admin system-config page —
 * NOT a billing reconciliation tool. Two independently uncertain inputs go
 * into every number here:
 *
 *   1. Public per-unit vendor pricing (Mistral, Azure Speech, Deepgram),
 *      checked against each vendor's own pricing page on 2026-08-14. Re-check
 *      the constants below if a vendor changes pricing or a LIVE_..._ID /
 *      env-configured model changes.
 *   2. Average per-session usage — turn counts, word counts, TTS characters,
 *      speaking rate — computed from the 37 sessions (of 180 total) in the
 *      last 180 days that have a stored `transcript`, via direct SQL against
 *      the `sessions` table. Small sample; re-run and update AVG_SESSION as
 *      real usage grows or shifts (e.g. once non-demo traffic dominates).
 *
 * Where an LLM call's prompt is fixed source text (CEFR_SYSTEM_PROMPT, the
 * ET pacing judge's SYSTEM_PROMPT, the EO ensemble's JUDGE_SYSTEM), its
 * length is measured exactly from that source rather than guessed. Variable,
 * per-turn content (the evidence a judge reads, the JSON it writes back) is
 * estimated from AVG_SESSION at ~4 characters/token — a standard rough
 * heuristic, not a real tokenizer — so these numbers are good for comparing
 * modules' relative cost, not for reconciling against a vendor invoice.
 */

// ─── Average real session (see file header for how this was derived) ──────

export const AVG_SESSION = {
  userTurns: 3.89,
  assistantTurns: 5.0,
  userWordsPerSession: 147.5,
  /** Derived from session_turns.content: avg 151.8 chars / 28.67 words per user turn. */
  charsPerWord: 5.3,
  assistantCharsPerSession: 361.4,
  userWpm: 143.5,
  /** Real average length of a completed CEFR-eval result_json (n=279, session_evaluations). */
  cefrEvalResultChars: 2220,
};

const userAudioMinutesPerSession = AVG_SESSION.userWordsPerSession / AVG_SESSION.userWpm;
const userCharsPerSession = AVG_SESSION.userWordsPerSession * AVG_SESSION.charsPerWord;
const userCharsPerTurn = userCharsPerSession / AVG_SESSION.userTurns;
const userWordsPerTurn = AVG_SESSION.userWordsPerSession / AVG_SESSION.userTurns;
const assistantCharsPerTurn = AVG_SESSION.assistantCharsPerSession / AVG_SESSION.assistantTurns;

// ─── Vendor pricing, checked 2026-08-14 ────────────────────────────────────
// Sources: mistral.ai/pricing/api, Azure retail-prices API (productName
// "Azure Speech", meters "S1 Speech To Text" / "S1 Speech to Text Enhanced
// Feature Audio" / "S1 Neural Text To Speech Characters"), deepgram.com/pricing.

const CHARS_PER_TOKEN = 4;

const MISTRAL_TEXT_PRICE_PER_M: Record<string, { in: number; out: number }> = {
  "mistral-large-latest": { in: 0.5, out: 1.5 },
  "mistral-small-latest": { in: 0.15, out: 0.6 },
};
const MISTRAL_TEXT_PRICE_FALLBACK = MISTRAL_TEXT_PRICE_PER_M["mistral-large-latest"];

const MISTRAL_TRANSCRIBE_PER_MIN = 0.003; // voxtral-mini-latest, dedicated transcription endpoint
const MISTRAL_TTS_PER_1K_CHARS = 0.016; // voxtral-mini-tts-2603

const AZURE_STT_PER_HOUR = 1.0;
const AZURE_PRONUNCIATION_ASSESSMENT_ADDON_PER_HOUR = 0.3; // billed on top of STT, same recognition call
const AZURE_NEURAL_TTS_PER_1M_CHARS = 15.0;

const DEEPGRAM_NOVA3_PRERECORDED_MONO_PER_MIN = 0.0077; // pay-as-you-go, monolingual (this app passes an explicit language)

function mistralTextPrice(modelLabel: string) {
  return MISTRAL_TEXT_PRICE_PER_M[modelLabel] ?? MISTRAL_TEXT_PRICE_FALLBACK;
}

function mistralTextCostUsd(modelLabel: string, inputChars: number, outputChars: number): number {
  const price = mistralTextPrice(modelLabel);
  const inTokens = inputChars / CHARS_PER_TOKEN;
  const outTokens = outputChars / CHARS_PER_TOKEN;
  return (inTokens / 1_000_000) * price.in + (outTokens / 1_000_000) * price.out;
}

// ─── Fixed prompt sizes, measured from source (see file header) ───────────
// Kept as plain char counts here rather than importing the prompt constants
// themselves — this module has no business re-rendering CEFR_SYSTEM_PROMPT
// etc., only estimating cost from their known length.
const CEFR_SYSTEM_PROMPT_CHARS = 14451;
const ET_SYSTEM_PROMPT_CHARS = 820;
const EO_JUDGE_SYSTEM_CHARS = 4824;

export interface CostEstimate {
  usdPerSession: number;
  /** One-line human-readable basis, shown in the cost tooltip. */
  note: string;
}

export function estimateSttCostUsd(providerId: string): CostEstimate | null {
  if (providerId !== "voxtral") return null; // only the live STT provider is priced
  return {
    usdPerSession: userAudioMinutesPerSession * MISTRAL_TRANSCRIBE_PER_MIN,
    note: `${userAudioMinutesPerSession.toFixed(2)} min user audio × $${MISTRAL_TRANSCRIBE_PER_MIN}/min (Voxtral transcribe)`,
  };
}

/** TTS cost for ONE language's live provider — the top-level TTS capability has no single answer since it varies by language. */
export function estimateTtsCostUsd(providerId: string): CostEstimate | null {
  if (providerId === "mistral") {
    const usd = (AVG_SESSION.assistantCharsPerSession / 1000) * MISTRAL_TTS_PER_1K_CHARS;
    return { usdPerSession: usd, note: `${AVG_SESSION.assistantCharsPerSession.toFixed(0)} chars × $${MISTRAL_TTS_PER_1K_CHARS}/1K chars (Voxtral TTS)` };
  }
  if (providerId === "azure") {
    const usd = (AVG_SESSION.assistantCharsPerSession / 1_000_000) * AZURE_NEURAL_TTS_PER_1M_CHARS;
    return { usdPerSession: usd, note: `${AVG_SESSION.assistantCharsPerSession.toFixed(0)} chars × $${AZURE_NEURAL_TTS_PER_1M_CHARS}/1M chars (Azure Standard Neural)` };
  }
  return null;
}

export function estimateEtCostUsd(providerId: string, modelLabel: string): CostEstimate | null {
  if (providerId !== "mistral") return null;
  // Fixed wrapper text around the two variable fields, measured from
  // lib/level-assessment.ts's `content:` template literal.
  const wrapperChars = 60;
  const inputChars = ET_SYSTEM_PROMPT_CHARS + wrapperChars + assistantCharsPerTurn + userCharsPerTurn;
  const outputChars = 22; // {"verdict":"struggled"} — fixed shape, longest verdict
  const perCallUsd = mistralTextCostUsd(modelLabel, inputChars, outputChars);
  const usd = perCallUsd * AVG_SESSION.userTurns;
  return { usdPerSession: usd, note: `${AVG_SESSION.userTurns.toFixed(1)} turns × ~${Math.round(inputChars / CHARS_PER_TOKEN)} tok in (${modelLabel})` };
}

export function estimateEoCostUsd(providerId: string, modelLabel: string): CostEstimate | null {
  if (providerId !== "azure-ensemble") return null; // the voxtral direct-audio alternative isn't live today

  const deepgramUsd = userAudioMinutesPerSession * DEEPGRAM_NOVA3_PRERECORDED_MONO_PER_MIN;
  const azureUsd =
    (userAudioMinutesPerSession / 60) * (AZURE_STT_PER_HOUR + AZURE_PRONUNCIATION_ASSESSMENT_ADDON_PER_HOUR);

  // Mistral judge call, per turn: evidence repeats the transcript 2x (live +
  // verbatim) plus a per-word confidence list and a per-word acoustic-score
  // list; the response is one small JSON entry per word. Word count comes
  // from the average user turn length above.
  const evidenceHeaderChars = 150;
  const perWordConfidenceChars = 12;
  const perWordAcousticChars = 15;
  const perWordJsonOutChars = 26;
  const evidenceChars =
    evidenceHeaderChars +
    userCharsPerTurn * 2 + // live + verbatim transcripts
    userWordsPerTurn * perWordConfidenceChars +
    userWordsPerTurn * perWordAcousticChars;
  const outputChars = userWordsPerTurn * perWordJsonOutChars + 100; // + turn_score/summary wrapper
  const inputChars = EO_JUDGE_SYSTEM_CHARS + evidenceChars;
  const mistralUsd = mistralTextCostUsd(modelLabel, inputChars, outputChars) * AVG_SESSION.userTurns;

  return {
    usdPerSession: deepgramUsd + azureUsd + mistralUsd,
    note:
      `${userAudioMinutesPerSession.toFixed(2)} min audio × (Deepgram $${DEEPGRAM_NOVA3_PRERECORDED_MONO_PER_MIN}/min + Azure $${(AZURE_STT_PER_HOUR + AZURE_PRONUNCIATION_ASSESSMENT_ADDON_PER_HOUR).toFixed(2)}/hr)` +
      ` + ${AVG_SESSION.userTurns.toFixed(1)} judge calls (${modelLabel})`,
  };
}

export function estimateCefrEvalCostUsd(providerId: string, modelLabel: string): CostEstimate | null {
  if (providerId !== "mistral") return null; // Anthropic pricing not modeled — it isn't the live judge today

  // buildEvaluationUserMessage's fixed wrapper text (language/turn-count
  // header, pronunciation section, "[Turn N · Xw]" labels) plus the actual
  // transcript.
  const wrapperChars = 900 + 13 * AVG_SESSION.userTurns;
  const inputChars = CEFR_SYSTEM_PROMPT_CHARS + wrapperChars + userCharsPerSession;
  const outputChars = AVG_SESSION.cefrEvalResultChars; // measured, not estimated
  const usd = mistralTextCostUsd(modelLabel, inputChars, outputChars);
  return { usdPerSession: usd, note: `1 call × ~${Math.round(inputChars / CHARS_PER_TOKEN)} tok in / ~${Math.round(outputChars / CHARS_PER_TOKEN)} tok out (${modelLabel})` };
}

export function formatUsd(usd: number): string {
  if (usd < 0.001) return `$${usd.toFixed(5)}`;
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(3)}`;
}
