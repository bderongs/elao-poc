/**
 * Track AD — "jokers": a generally strong candidate's one or two odd errors are
 * presumed to be the speech recogniser's, not the speaker's, and are not counted.
 *
 * Evidence that motivates it (scripts/asr-disagreement.ts, 2026-10-05): about 9 %
 * of live-transcript words differ from an independent recogniser, and a handful
 * of misheard words ("long juggernauts" for "long diagonals") dragged a strong
 * speaker's pronunciation to 83.6 instead of ~90 and removed the +5 % bonus.
 *
 * Deliberately simple and blind: no cross-recogniser comparison, just a small,
 * capped allowance that grows with the answer's length and only applies when
 * the rest of the answer is clearly good. Both uses read the settings below —
 * edit them here (in code, not in admin):
 *
 *   1. Pronunciation (applyPronunciationForgiveness) — per answer, the worst
 *      flagged words are left out of that answer's score.
 *   2. Final evaluator (buildEvaluatorForgivenessNote) — a note in the user
 *      message tells the model how many apparent errors to presume are
 *      recognition errors.
 */

import type { WordScore } from "@/lib/pronunciation/types";

export const RECOGNITION_FORGIVENESS = {
  /** Master switch for both uses. */
  enabled: true,

  // ── Pronunciation, per answer ──────────────────────────────────────────────
  /** A word is "flagged" (a candidate to forgive) when its accuracy is below this.
   *  The judge maps off → 42 and bad → 16; ok → 72 and good → 96 are never flagged. */
  flaggedBelowAccuracy: 50,
  /** Answers shorter than this get no allowance — one bad word in a few is probably real. */
  minAnswerWords: 8,
  /** Answers of at least this many words get the larger allowance below. */
  longAnswerWords: 40,
  /** Words forgiven in an answer of minAnswerWords…longAnswerWords-1 words. */
  allowanceMedium: 1,
  /** Words forgiven in an answer of longAnswerWords or more. Hard cap per answer. */
  allowanceLong: 2,
  /** "Generally good" test: after removing the forgiven words, the rest of the
   *  answer must average at least this accuracy (0-100) or nothing is forgiven. */
  minRemainingAverage: 85,

  // ── Final evaluator, per session ───────────────────────────────────────────
  /** Apparent errors presumed to be recognition errors: one per this many words
   *  spoken in the session… */
  evaluatorWordsPerForgivenError: 60,
  /** …but never more than this many in total. */
  evaluatorMaxForgivenErrors: 3,
  /** Only for a strong speaker: the session's pronunciation average (0-100)… */
  evaluatorMinPronunciation: 85,
  /** …and speaking rate (words per minute) must both reach these. */
  evaluatorMinWpm: 110,
  /** Sessions with fewer words than this get no evaluator allowance. */
  evaluatorMinTotalWords: 100,
} as const;

/** Words forgiven in one answer of `wordCount` words (0 when too short or disabled). */
export function pronunciationAllowance(wordCount: number): number {
  const c = RECOGNITION_FORGIVENESS;
  if (!c.enabled || wordCount < c.minAnswerWords) return 0;
  return wordCount >= c.longAnswerWords ? c.allowanceLong : c.allowanceMedium;
}

export interface ForgivenessOutcome {
  /** Indices (into the word array) of the forgiven words. Empty = nothing forgiven. */
  forgivenIndices: number[];
  /** The answer's score recomputed without the forgiven words; null when nothing was forgiven. */
  score: number | null;
}

/**
 * Picks the worst flagged words of one answer, up to the length-based
 * allowance, and recomputes the answer's average without them — but only when
 * the rest of the answer still averages at least `minRemainingAverage`.
 */
export function applyPronunciationForgiveness(words: Pick<WordScore, "accuracyScore">[]): ForgivenessOutcome {
  const none: ForgivenessOutcome = { forgivenIndices: [], score: null };
  const c = RECOGNITION_FORGIVENESS;
  const allowance = pronunciationAllowance(words.length);
  if (allowance === 0) return none;

  const flagged = words
    .map((w, i) => ({ i, acc: w.accuracyScore }))
    .filter((w) => w.acc < c.flaggedBelowAccuracy)
    .sort((a, b) => a.acc - b.acc)
    .slice(0, allowance);
  if (flagged.length === 0) return none;

  const skip = new Set(flagged.map((f) => f.i));
  const rest = words.filter((_, i) => !skip.has(i));
  if (rest.length === 0) return none;
  const restAvg = rest.reduce((s, w) => s + w.accuracyScore, 0) / rest.length;
  if (restAvg < c.minRemainingAverage) return none;

  return { forgivenIndices: flagged.map((f) => f.i).sort((a, b) => a - b), score: Math.round(restAvg) };
}

/**
 * How many apparent vocabulary/grammar errors the final evaluator is told to
 * presume are recognition errors for this session (0 = no allowance: the
 * speaker isn't strong enough, the session is too short, or it's disabled).
 * Shared by the evaluator note and the admin summary.
 */
export function evaluatorAllowance(args: {
  pronunciation: number | null | undefined;
  wpm: number | null | undefined;
  totalWords: number;
}): number {
  const c = RECOGNITION_FORGIVENESS;
  if (!c.enabled) return 0;
  if (args.totalWords < c.evaluatorMinTotalWords) return 0;
  if ((args.pronunciation ?? 0) < c.evaluatorMinPronunciation) return 0;
  if ((args.wpm ?? 0) < c.evaluatorMinWpm) return 0;
  return Math.min(c.evaluatorMaxForgivenErrors, Math.floor(args.totalWords / c.evaluatorWordsPerForgivenError));
}

/**
 * Note appended to the evaluator's user message for a strong speaker; null when
 * evaluatorAllowance is 0.
 */
export function buildEvaluatorForgivenessNote(args: {
  pronunciation: number | null | undefined;
  wpm: number | null | undefined;
  totalWords: number;
}): string | null {
  const n = evaluatorAllowance(args);
  if (n < 1) return null;
  return (
    `\nRECOGNITION-ERROR ALLOWANCE: this speaker is strong (pronunciation ${Math.round(args.pronunciation ?? 0)}/100, ${Math.round(args.wpm ?? 0)} WPM). ` +
    `Presume that up to ${n} apparent vocabulary or grammar error${n === 1 ? "" : "s"} in the whole transcript (the most doubtful ones: odd word choices, words that do not fit the sentence, mangled phrases) ` +
    `are the speech recogniser's mistakes, NOT the speaker's. Do not quote them in notable_errors and do not let them lower vocabulary_grammar. ` +
    `Errors beyond that allowance, or the same error repeated, still count.\n`
  );
}
