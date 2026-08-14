export interface WordScore {
  word: string;
  /** AccuracyScore / 100  →  0–1 */
  confidence: number;
  accuracyScore: number;
  /** "None" | "Omission" | "Insertion" | "Mispronunciation" | "UnexpectedBreak" | "MissingBreak" | "Monotone" */
  errorType: string;
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
}

export interface PronunciationProvider {
  id: string;
  label: string;
  /** Human-readable model identifier, shown in the admin system-config page and per-session records. */
  modelLabel: string;
  assess(params: PronunciationAssessParams): Promise<PronunciationResult | null>;
}
