import type { VerbatimEngine } from "@/lib/pronunciation/verbatim";
export interface WordScore {
  word: string;
  /** AccuracyScore / 100  →  0–1 */
  confidence: number;
  accuracyScore: number;
  /** "None" | "Omission" | "Insertion" | "Mispronunciation" | "UnexpectedBreak" | "MissingBreak" | "Monotone" */
  errorType: string;
  /** Left out of this answer's score as a presumed recognition error
   *  (lib/recognition-forgiveness.ts). The word keeps its own score/colour. */
  forgiven?: boolean;
}

export interface PronunciationResult {
  text: string;
  /** Overall composite score 0-100 */
  pronunciationScore: number;
  /** Phoneme-level accuracy 0-100 */
  accuracyScore: number;
  /** Words per minute */
  wpm: number;
  words: WordScore[];
  /**
   * Which engine produced these scores.
   * 'deepgram' = initial word-confidence proxy (historical — no longer produced live).
   * 'azure'    = server-side Azure Pronunciation Assessment REST result (historical
   *              — kept for reading old sessions; azure-ensemble is admin-only now).
   * 'voxtral'  = single-call direct audio assessment (lib/pronunciation/providers/voxtral.ts).
   */
  source?: "deepgram" | "azure" | "voxtral";
  /**
   * Which evidence the score was built on (azure-ensemble, azure-intended).
   * Both engines fail silently — the judge then runs without that evidence —
   * so this is the only record of it. Absent on results before 2026-11-19.
   */
  evidence?: PronunciationEvidence;
}

export interface PronunciationEvidence {
  /** Second-hearing engine that answered (lib/pronunciation/verbatim.ts); null = it failed, the judge ran without it. */
  verbatim: VerbatimEngine | null;
  /** Azure free-speech acoustic scores came back. */
  azure: boolean;
  /** The Mistral judge answered; false = the score is Azure acoustic alone (fallback). */
  judge: boolean;
}

export interface PronunciationAssessParams {
  audio: ArrayBuffer;
  contentType: string;
  langCode: string;
  /** Live transcript of this turn, when known (e.g. from the conversation UI). */
  referenceText?: string;
  /** The examiner's question the learner was answering, when known. */
  context?: string;
  /** Client-measured WPM fallback, used only when server-side duration is unavailable. */
  clientWpm?: number;
  /** H-01 latency-instrumentation id (app/page.tsx's turnLogId, e.g. "turn-1") —
   *  threaded through so this call's logs (labeled EO{n}, see lib/turn-labels.ts)
   *  are correlatable with the rest of that turn's timeline. */
  turnLogId?: string;
  /** Second-hearing engine (lib/pronunciation/verbatim.ts) — replays only; live uses LIVE_VERBATIM_ENGINE. */
  verbatimEngine?: VerbatimEngine;
}

export interface PronunciationProvider {
  id: string;
  label: string;
  /** Human-readable model identifier, shown in the admin system-config page and per-session records. */
  modelLabel: string;
  assess(params: PronunciationAssessParams): Promise<PronunciationResult | null>;
}
