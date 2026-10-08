import { FLUENCY_WPM_BANDS } from "@/lib/cefr-prompt";
import type { CefrResult, PronunciationAvg, SpeechaceScores } from "@/lib/types";

/** Derive CEFR level from composite score (5-point bands). */
export function scoreToLevel(score: number): string {
  if (score >= 90) return "C2";
  if (score >= 85) return "C1+";
  if (score >= 80) return "C1";
  if (score >= 75) return "B2+";
  if (score >= 70) return "B2";
  if (score >= 65) return "B1+";
  if (score >= 60) return "B1";
  if (score >= 55) return "A2+";
  if (score >= 50) return "A2";
  if (score >= 45) return "A1+";
  if (score >= 40) return "A1";
  return "A0";
}

export interface CompositeCefrScore {
  score: number;
  level: string;
}

/**
 * The scoring rules as data. `SCORING_RULES` is what the app runs;
 * analysis/ (npm run analysis:scoring) re-scores stored sessions with
 * alternative rule sets through the SAME `scoreWithRules`, so a what-if can
 * never drift from the live formula. See analysis/README.md.
 */
export interface ScoringRules {
  /** "llm" = the evaluator's holistic score_percent. "axis-mean" = mean of the available axes (pronunciation, fluency, vocabulary/grammar, communication) × 10. */
  baseScore: "llm" | "axis-mean";
  /** Clamp the LLM's fluency axis into the band the speaking rate dictates (FLUENCY_WPM_BANDS) — only when the rate is trustworthy, see WPM_RELIABLE. Needs the answer evidence; sessions without it are left as the LLM scored them. */
  fluencyFromWpm: boolean;
  /** Excellence bonus: `pct` % on top of the base score when `minAxes` of the axes reach `axisThreshold` (0–10 scale; 8.5 does not count at 9). */
  bonus: { minAxes: number; axisThreshold: number; pct: number };
  /** A floor that lifts a clearly excellent session to `floor`. null = off. Needs the answer evidence stamped on the evaluation (answer_count, words_per_answer); sessions without it never get the floor. */
  c2Floor: null | {
    floor: number;
    minAxesHigh: number;
    axisHigh: number;
    noAxisBelow: number;
    minAnswers: number;
    minWordsPerAnswer: number;
  };
}

/** Activated 2026-10-08 (Baptiste): axis mean as the base, the Track V C2 floor, and the WPM→fluency table enforced in code (AB-07). */
export const SCORING_RULES: ScoringRules = {
  baseScore: "axis-mean",
  fluencyFromWpm: true,
  bonus: { minAxes: 2, axisThreshold: 9, pct: 5 },
  c2Floor: { floor: 90, minAxesHigh: 3, axisHigh: 9, noAxisBelow: 8, minAnswers: 5, minWordsPerAnswer: 20 },
};

/**
 * A speaking rate measured on a handful of words is noise (one 7-word answer
 * measured at 341 wpm), so the WPM→fluency clamp only applies when there is
 * enough speech behind the number and the rate is plausible.
 */
export const WPM_RELIABLE = { minAnswers: 3, minWords: 100, maxWpm: 220 };

export interface ScoreEvidence {
  answers: number | null;
  wordsPerAnswer: number | null;
}

export interface ScoreOutcome extends CompositeCefrScore {
  /** Short human-readable list of the rules that moved the number (replay reports). */
  notes: string[];
}

interface WpmBand { min: number; max: number; fluencyLo: number; fluencyHi: number }

/** Parses FLUENCY_WPM_BANDS ("< 35", "35-44", "≥ 145" / "4-5", "8-8.5", "10") so the table stays defined in one place. */
function wpmBands(): WpmBand[] {
  return FLUENCY_WPM_BANDS.map((b) => {
    const r = b.range.trim();
    let min: number, max: number;
    if (r.startsWith("<")) { min = 0; max = Number(r.slice(1)) - 1; }
    else if (r.startsWith("≥")) { min = Number(r.slice(1)); max = Infinity; }
    else { const [a, z] = r.split("-").map(Number); min = a; max = z; }
    const [lo, hi] = b.fluency.includes("-") ? b.fluency.split("-").map(Number) : [Number(b.fluency), Number(b.fluency)];
    return { min, max, fluencyLo: lo, fluencyHi: hi };
  });
}

/**
 * The fluency axis forced into the band the speaking rate dictates
 * (FLUENCY_WPM_BANDS) — returned unchanged when the rate is not trustworthy
 * (WPM_RELIABLE) or the answer evidence is missing. Idempotent.
 */
export function fluencyFromWpm(fluency: number, wpm: number, answers: number | null, wordsPerAnswer: number | null): number {
  const reliable =
    wpm > 0 &&
    wpm <= WPM_RELIABLE.maxWpm &&
    answers !== null &&
    wordsPerAnswer !== null &&
    answers >= WPM_RELIABLE.minAnswers &&
    answers * wordsPerAnswer >= WPM_RELIABLE.minWords;
  if (!reliable) return fluency;
  const bands = wpmBands();
  // Last band whose lower bound the rate reaches (handles rates like 34.6 that fall between two integer-bounded bands).
  const b = [...bands].reverse().find((x) => wpm >= x.min) ?? bands[0];
  return Math.min(b.fluencyHi, Math.max(b.fluencyLo, fluency));
}

export function scoreWithRules(
  result: CefrResult,
  pronunciationAvg: PronunciationAvg | null,
  rules: ScoringRules,
  evidence: ScoreEvidence = { answers: result.answer_count ?? null, wordsPerAnswer: result.words_per_answer ?? null },
): ScoreOutcome {
  const notes: string[] = [];
  const pronScore = pronunciationAvg ? pronunciationAvg.pronunciation / 10 : null;

  let fluency = result.dimensions.fluency;
  if (rules.fluencyFromWpm && fluency !== null && pronunciationAvg) {
    const clamped = fluencyFromWpm(fluency, pronunciationAvg.wpm, evidence.answers, evidence.wordsPerAnswer);
    if (clamped !== fluency) notes.push(`fluency ${fluency}→${clamped} (${Math.round(pronunciationAvg.wpm)} wpm)`);
    fluency = clamped;
  }
  const present = [pronScore, fluency, result.dimensions.vocabulary_grammar, result.dimensions.communication].filter(
    (v): v is number => v !== null,
  );

  let baseScore = result.score_percent;
  if (rules.baseScore === "axis-mean" && present.length) {
    baseScore = Math.round((present.reduce((a, b) => a + b, 0) / present.length) * 10);
    if (baseScore !== result.score_percent) notes.push(`base ${result.score_percent}→${baseScore} (axis mean)`);
  }

  const highCount = present.filter((v) => v >= rules.bonus.axisThreshold).length;
  let score = highCount >= rules.bonus.minAxes ? Math.min(100, Math.round(baseScore * (1 + rules.bonus.pct / 100))) : baseScore;
  if (score !== baseScore) notes.push(`+${rules.bonus.pct}% bonus`);

  const f = rules.c2Floor;
  if (f && score < f.floor && evidence.answers !== null && evidence.wordsPerAnswer !== null) {
    const strong = present.filter((v) => v >= f.axisHigh).length >= f.minAxesHigh;
    const noWeak = present.every((v) => v >= f.noAxisBelow);
    if (strong && noWeak && evidence.answers >= f.minAnswers && evidence.wordsPerAnswer >= f.minWordsPerAnswer) {
      score = f.floor;
      notes.push(`C2 floor ${f.floor}`);
    }
  }

  // The evaluator's own level label is kept only when nothing moved its number.
  const level = score === result.score_percent ? (result.level ?? scoreToLevel(score)) : scoreToLevel(score);
  return { score, level, notes };
}

/**
 * "Our" global score for a session: the evaluator's four dimensions
 * (pronunciation from our own audio engine, fluency/vocabulary_grammar/
 * communication from the LLM, the last three in half points) combined by
 * `SCORING_RULES` — mean of the axes, +5 % when ≥ 2 axes reach 9 (8.5 does
 * not count), and a C2 floor for clearly excellent sessions. Single source of
 * truth for "our global score", shared by the live CefrPanel display and the
 * Speechace comparison — anywhere the app needs to say "here is our one
 * overall number" it should call this rather than reading
 * `result.score_percent` directly, which is the LLM's holistic number alone.
 */
export function computeCompositeCefrScore(result: CefrResult, pronunciationAvg: PronunciationAvg | null): CompositeCefrScore {
  const { score, level } = scoreWithRules(result, pronunciationAvg, SCORING_RULES);
  return { score, level };
}

export interface SessionMainScore extends CompositeCefrScore {
  /** Which stored field the number came from — lets the UI label it honestly. */
  source: "cefr" | "speechace" | "pronunciation";
}

interface ScorableSession {
  cefr_level: string | null;
  global_score: number | null;
  evaluation_json: CefrResult | null;
  pronunciation_scores: PronunciationAvg | null;
  speechace_scores: SpeechaceScores | null;
  /**
   * Fallback for upload/Speechace-import sessions: `evaluation_json` is only
   * ever written by the live conversation flow, so those sessions have no
   * CEFR result there even after being run through the eval lab — the
   * result lives in `session_evaluations` instead. `listSessions` resolves
   * "latest successful eval-lab run" the same way the detail page does
   * (see app/admin/(dashboard)/[id]/page.tsx) and attaches it here, so a
   * session shows the same "our score" in both places instead of the list
   * silently having none.
   */
  latest_eval_json?: CefrResult | null;
}

function resolveCefrResult(session: ScorableSession): CefrResult | null {
  return session.evaluation_json ?? session.latest_eval_json ?? null;
}

/**
 * The one headline number for a session row, picked from whichever score
 * field is actually populated for that session's source (see
 * SESSION_SUMMARY_COLUMNS): a live conversation has evaluation_json, an
 * uploaded recording may only have pronunciation_scores, a Speechace import
 * only has speechace_scores. Returns null when nothing has been scored yet.
 */
export function computeSessionMainScore(session: ScorableSession): SessionMainScore | null {
  const cefrResult = resolveCefrResult(session);
  if (cefrResult) {
    return { ...computeCompositeCefrScore(cefrResult, session.pronunciation_scores), source: "cefr" };
  }
  if (session.global_score != null && session.cefr_level) {
    return { score: session.global_score, level: session.cefr_level, source: "cefr" };
  }
  if (session.speechace_scores?.overall != null) {
    const score = Math.round(session.speechace_scores.overall);
    return { score, level: scoreToLevel(score), source: "speechace" };
  }
  if (session.pronunciation_scores?.score != null) {
    const score = Math.round(session.pronunciation_scores.score);
    return { score, level: scoreToLevel(score), source: "pronunciation" };
  }
  return null;
}

export interface ScoreBreakdownRow {
  label: string;
  value: number;
  max: number;
}

export interface ScoreBreakdownGroup {
  title: string;
  rows: ScoreBreakdownRow[];
}

interface DimensionScore {
  /** Which engine produced this number — the row label, so same-dimension scores read as a direct comparison. */
  source: string;
  value: number;
}

/**
 * Every score we hold for a session, grouped by source (Ours/Speechace) —
 * for the session LIST page's hover popover (components/SessionScoreCell.tsx).
 * "Global" (the one holistic number per source) and "Pronunciation" (the one
 * pronunciation-engine number per source) — not a per-dimension breakdown.
 * The session DETAIL page's per-category breakdown lives in
 * lib/score-breakdown.ts instead.
 * `pronunciation_scores.score` is deliberately not a third "global" source:
 * it's literally `Math.round(pronunciation_scores.pronunciation)` (see
 * lib/pronunciation-rollup.ts's computePronunciationAvg), i.e. the same
 * pronunciation number again, not a distinct construct.
 */
export function sessionScoreBreakdown(session: ScorableSession): ScoreBreakdownGroup[] {
  const cefrResult = resolveCefrResult(session);
  const global: DimensionScore[] = [];
  const pronunciation: DimensionScore[] = [];

  if (cefrResult) {
    const { score } = computeCompositeCefrScore(cefrResult, session.pronunciation_scores);
    global.push({ source: "Ours", value: score });
  }
  if (session.speechace_scores?.overall != null) {
    global.push({ source: "Speechace", value: session.speechace_scores.overall });
  }

  if (session.pronunciation_scores) {
    pronunciation.push({ source: "Ours", value: session.pronunciation_scores.pronunciation });
  }
  if (session.speechace_scores?.pronunciation != null) {
    pronunciation.push({ source: "Speechace", value: session.speechace_scores.pronunciation });
  }

  const toGroup = (title: string, scores: DimensionScore[]): ScoreBreakdownGroup | null =>
    scores.length ? { title, rows: scores.map((s) => ({ label: s.source, value: s.value, max: 100 })) } : null;

  return [toGroup("Global", global), toGroup("Pronunciation", pronunciation)].filter(
    (g): g is ScoreBreakdownGroup => g !== null,
  );
}
