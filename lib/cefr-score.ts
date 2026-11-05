import { FLUENCY_WPM_BANDS } from "@/lib/cefr-prompt";
import type { CefrResult, PronunciationAvg, SpeechaceScores } from "@/lib/types";

/** The levels the score is labelled with, in ascending order (A0 is everything below A1's floor). */
export const SCORED_LEVELS = ["A1", "A1+", "A2", "A2+", "B1", "B1+", "B2", "B2+", "C1", "C1+", "C2"] as const;
export type ScoredLevel = (typeof SCORED_LEVELS)[number];

/** Lowest score (0–100) of each level. */
export type LevelFloors = Record<ScoredLevel, number>;

/** 5-point bands. Admins can override them (/admin/settings, lib/scoring-settings-service.ts). */
export const DEFAULT_LEVEL_FLOORS: LevelFloors = {
  A1: 40, "A1+": 45, A2: 50, "A2+": 55, B1: 60, "B1+": 65, B2: 70, "B2+": 75, C1: 80, "C1+": 85, C2: 90,
};

/** Top of C1+, the highest score reported (ScoringRules.ceiling). */
const SCORING_RULES_CEILING_CAP = 89;

/** The levels an admin can move: C2 stays at 90, above the C1+ ceiling (ScoringRules.ceiling), since the test never reports it. */
export const EDITABLE_LEVELS = SCORED_LEVELS.filter((l) => l !== "C2");

/**
 * Admin-entered floors, checked: whole numbers from 1 to the ceiling (89),
 * strictly ascending. Throws with a readable message on anything else;
 * missing levels take the default.
 */
export function parseLevelFloors(input: unknown): LevelFloors {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const floors = { ...DEFAULT_LEVEL_FLOORS };
  const cap = SCORING_RULES_CEILING_CAP;
  for (const level of EDITABLE_LEVELS) {
    if (raw[level] === undefined) continue;
    const v = Number(raw[level]);
    if (!Number.isInteger(v) || v < 1 || v > cap) throw new Error(`${level}: a whole number from 1 to ${cap}`);
    floors[level] = v;
  }
  for (let i = 1; i < SCORED_LEVELS.length; i++) {
    const [lo, hi] = [SCORED_LEVELS[i - 1], SCORED_LEVELS[i]];
    if (floors[hi] <= floors[lo]) throw new Error(`${hi} (${floors[hi]}) must be above ${lo} (${floors[lo]})`);
  }
  return floors;
}

/** Derive CEFR level from composite score. */
export function scoreToLevel(score: number, floors: LevelFloors = DEFAULT_LEVEL_FLOORS): string {
  for (let i = SCORED_LEVELS.length - 1; i >= 0; i--) {
    if (score >= floors[SCORED_LEVELS[i]]) return SCORED_LEVELS[i];
  }
  return "A0";
}

export const isDefaultFloors = (floors: LevelFloors) => SCORED_LEVELS.every((l) => floors[l] === DEFAULT_LEVEL_FLOORS[l]);

const baseLevelOf = (score: number, floors: LevelFloors) => scoreToLevel(score, floors).replace("+", "");

export interface CompositeCefrScore {
  score: number;
  level: string;
  /** At the top of the scale the test assesses (ScoringRules.ceiling) — the results screen says the level may be higher still. */
  topOfScale?: boolean;
}

/**
 * The scoring rules as data. `SCORING_RULES` is what the app runs;
 * analysis/ (npm run analysis:scoring) re-scores stored sessions with
 * alternative rule sets through the SAME `scoreWithRules`, so a what-if can
 * never drift from the live formula. See analysis/README.md.
 */
export interface ScoringRules {
  /** "llm" = the evaluator's holistic score_percent. "axis-mean" = mean of the available axes (pronunciation, fluency, vocabulary/grammar, communication), mapped to 0–100 by `axisCurve`. */
  baseScore: "llm" | "axis-mean";
  /** Axis mean (0–10) → score (0–100), piecewise linear through these [mean, score] points (ascending). null = mean × 10. */
  axisCurve: [number, number][] | null;
  /** Pronunciation engine score (0–100) → pronunciation axis (0–10), piecewise linear through these [score, axis] points. The engines squeeze every level into ~65–82, so a weak speaker gets ~8/10; a curve stretches that range. null = score ÷ 10. */
  pronunciationCurve: [number, number][] | null;
  /**
   * Weight of the pronunciation axis in the axis mean (the other axes weigh 1), as a function of the
   * mean of the other axes — piecewise linear through these [mean, weight] points. The engines rate
   * how clearly the words were said, not how much the speaker can say: a beginner saying five simple
   * words clearly scores like a B2, so at the low end it should count less. null = weight 1 everywhere.
   */
  pronunciationWeight: [number, number][] | null;
  /**
   * The most the pronunciation axis may sit above the mean of the other axes (0–10 points); above
   * that it counts as that mean + `pronunciationLift`. One-sided: it can still pull the score down.
   * The engines rate a beginner's few clear words like a B2's (2026-11-05: Azure, Voxtral and the
   * judge all give French A1s 74–88), so pronunciation alone shouldn't lift anyone a level. null = off.
   */
  pronunciationLift: number | null;
  /** Speaking rate vs. the LLM's fluency axis (FLUENCY_WPM_BANDS), only when the rate is trustworthy (WPM_RELIABLE) and the answer evidence is there. "cap" = the rate's band caps fluency, never raises it. "band" = clamped into the band, raised or capped (AB-07, 2026-10-08 → 2026-10-14). "off" = the LLM's value as is. */
  fluencyFromWpm: "cap" | "band" | "off";
  /** Excellence bonus: `pct` % on top of the base score when `minAxes` of the axes reach `axisThreshold` (0–10 scale; 8.5 does not count at 9). null = off. */
  bonus: null | { minAxes: number; axisThreshold: number; pct: number };
  /** A floor that lifts a clearly excellent session to `floor`. null = off. Needs the answer evidence stamped on the evaluation (answer_count, words_per_answer); sessions without it never get the floor. */
  c2Floor: null | {
    floor: number;
    minAxesHigh: number;
    axisHigh: number;
    noAxisBelow: number;
    minAnswers: number;
    minWordsPerAnswer: number;
  };
  /**
   * C2 is decided by evidence, not by the axes alone: at most
   * `maxSpeakerErrors` genuine vocabulary/grammar errors in the whole
   * conversation (the jokers — the evaluator's speaker_errors) and at least
   * `minC2AnswersWell` answers to C2-bank questions judged "well"
   * (c2_answers_well, stamped at evaluation time).
   * - Without that evidence, a score in the C2 band is held at `cap`.
   *   Sessions evaluated before the evidence existed (2026-10-14) never pass.
   * - With it, a session whose axis mean reaches `liftFromAxisMean` is lifted
   *   to C2 (`cap` + 1): the evaluator scores a native ~9 per axis, the same
   *   as a strong C1, so the axes can't separate them — the C2 questions can
   *   (a native French session: mean 8.84, three C2 answers "well"). null = no lift.
   * maxSpeakerErrors null = the error count isn't checked (it proved unreliable:
   * false errors on natives, missed ones on C1 speakers).
   * null = gate off.
   */
  c2Gate: null | { maxSpeakerErrors: number | null; minC2AnswersWell: number; cap: number; liftFromAxisMean: number | null };
  /**
   * Boundary checks (lib/cefr-boundary.ts, stamped on the evaluation): a judge
   * compares the speaker with the description of their level and the one
   * above / below, twice. "up": both runs say "the level above" → the score
   * rises to that level's floor. "both": also, when the upward check doesn't
   * fire and both runs of the downward one say "the level below", the score
   * drops to the top of that level. "off": ignored. Only applies when the
   * score still sits in the level the checks were run from.
   */
  boundaryCheck: "off" | "up" | "both";
  /**
   * The highest level the test reports. C1 and C2 can't be told apart
   * reliably from a short conversation (calibration and live tests,
   * 2026-10-14…18), so scores stop at `cap` (89, C1+). A session that shows
   * C2-type evidence — at least `minC2AnswersWell` answers to C2-bank
   * questions judged "well" and an axis mean of at least `minAxisMean` — is
   * flagged `topOfScale` instead of being lifted to C2. Applied last. null = no ceiling.
   */
  ceiling: null | { cap: number; topOfScale: { minC2AnswersWell: number; minAxisMean: number } };
  /** Score → level cut-offs. The defaults are 5-point bands; the live value comes from the admin settings (getLiveScoringRules). */
  levelFloors: LevelFloors;
}

/**
 * Activated 2026-10-14 (Baptiste, after a C1 speaker was rated C2): the axis
 * mean goes through a curve so the evaluator's C1 band (8–9 per axis) lands
 * in C1/C1+ instead of C2 (a mean of 9 is 87, C2 needs ~9.5); no +5 % bonus
 * and no C2 floor (both lifted C1 sessions into C2); the speaking rate only
 * caps fluency.
 * 2026-10-18 (Baptiste): the test no longer reports C2 — scores stop at C1+,
 * with a "top of the scale" flag on C2-type evidence (`ceiling`); the C2 gate
 * and the boundary checks are off.
 * 2026-11-05 (Baptiste, after an A1 candidate was rated A0): the curve's low
 * end — an axis mean of 3, the evaluator's "A1", is 40 (A1's floor) instead
 * of 30; unchanged from 5 (A2) up.
 */
export const SCORING_RULES: ScoringRules = {
  baseScore: "axis-mean",
  axisCurve: [[0, 0], [3, 40], [5, 50], [8, 80], [9.5, 90], [10, 100]],
  pronunciationCurve: null,
  pronunciationWeight: null,
  pronunciationLift: null,
  fluencyFromWpm: "cap",
  bonus: null,
  c2Floor: null,
  c2Gate: null,
  boundaryCheck: "off",
  ceiling: { cap: SCORING_RULES_CEILING_CAP, topOfScale: { minC2AnswersWell: 2, minAxisMean: 8.75 } },
  levelFloors: DEFAULT_LEVEL_FLOORS,
};

/** SCORING_RULES with the admin's level floors — what every display passes in once it has read them. */
export function withLevelFloors(levelFloors: LevelFloors | null | undefined): ScoringRules {
  return levelFloors ? { ...SCORING_RULES, levelFloors } : SCORING_RULES;
}

/**
 * A speaking rate measured on a handful of words is noise (one 7-word answer
 * measured at 341 wpm), so the WPM→fluency rule only applies when there is
 * enough speech behind the number and the rate is plausible.
 */
export const WPM_RELIABLE = { minAnswers: 3, minWords: 100, maxWpm: 220 };

export interface ScoreEvidence {
  answers: number | null;
  wordsPerAnswer: number | null;
  /** Genuine vocabulary/grammar errors the evaluator counted (speaker_errors.length); null when the evaluation predates the field. */
  speakerErrors: number | null;
  /** Answers to C2-bank questions judged "well" (c2_answers_well); null when the evaluation predates the field. */
  c2AnswersWell: number | null;
}

/** The evidence stamped on an evaluation — what the live score uses. */
export function storedEvidence(result: CefrResult): ScoreEvidence {
  return {
    answers: result.answer_count ?? null,
    wordsPerAnswer: result.words_per_answer ?? null,
    speakerErrors: Array.isArray(result.speaker_errors) ? result.speaker_errors.length : null,
    c2AnswersWell: result.c2_answers_well ?? null,
  };
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
 * The fluency axis held to the band the speaking rate dictates
 * (FLUENCY_WPM_BANDS): "cap" (live) only lowers it to the band's top, "band"
 * also raises it to the band's bottom. Returned unchanged when the rate is
 * not trustworthy (WPM_RELIABLE) or the answer evidence is missing. Idempotent.
 */
export function fluencyFromWpm(
  fluency: number,
  wpm: number,
  answers: number | null,
  wordsPerAnswer: number | null,
  mode: "cap" | "band" = "cap",
): number {
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
  const capped = Math.min(b.fluencyHi, fluency);
  return mode === "band" ? Math.max(b.fluencyLo, capped) : capped;
}

/** Piecewise-linear lookup of `x` on `curve` (ascending [x, y] points), clamped at both ends. */
function onCurve(x: number, curve: [number, number][]): number {
  if (x <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    const [x0, y0] = curve[i - 1];
    const [x1, y1] = curve[i];
    if (x <= x1) return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  }
  return curve[curve.length - 1][1];
}

/** Piecewise-linear lookup of an axis mean on `curve`; null = × 10. */
function axisMeanToScore(mean: number, curve: [number, number][] | null): number {
  return curve ? onCurve(mean, curve) : mean * 10;
}

export function scoreWithRules(
  result: CefrResult,
  pronunciationAvg: PronunciationAvg | null,
  rules: ScoringRules,
  evidence: ScoreEvidence = storedEvidence(result),
): ScoreOutcome {
  const notes: string[] = [];
  const pronScore = pronunciationAvg
    ? rules.pronunciationCurve
      ? Math.round(onCurve(pronunciationAvg.pronunciation, rules.pronunciationCurve) * 2) / 2
      : pronunciationAvg.pronunciation / 10
    : null;

  let fluency = result.dimensions.fluency;
  if (rules.fluencyFromWpm !== "off" && fluency !== null && pronunciationAvg) {
    const adjusted = fluencyFromWpm(fluency, pronunciationAvg.wpm, evidence.answers, evidence.wordsPerAnswer, rules.fluencyFromWpm);
    if (adjusted !== fluency) notes.push(`fluency ${fluency}→${adjusted} (${Math.round(pronunciationAvg.wpm)} wpm)`);
    fluency = adjusted;
  }
  const present = [pronScore, fluency, result.dimensions.vocabulary_grammar, result.dimensions.communication].filter(
    (v): v is number => v !== null,
  );

  const others = [fluency, result.dimensions.vocabulary_grammar, result.dimensions.communication].filter((v): v is number => v !== null);
  const othersMean = others.length ? others.reduce((a, b) => a + b, 0) / others.length : null;
  const pronWeight = pronScore !== null && othersMean !== null && rules.pronunciationWeight ? onCurve(othersMean, rules.pronunciationWeight) : 1;
  const pronAxis =
    pronScore !== null && othersMean !== null && rules.pronunciationLift !== null ? Math.min(pronScore, othersMean + rules.pronunciationLift) : pronScore;
  if (pronAxis !== pronScore) notes.push(`pronunciation ${pronScore}→${Math.round(pronAxis! * 100) / 100} (lift capped at +${rules.pronunciationLift})`);
  const axisMean = present.length
    ? (others.reduce((a, b) => a + b, 0) + (pronAxis ?? 0) * (pronAxis !== null ? pronWeight : 0)) / (others.length + (pronAxis !== null ? pronWeight : 0))
    : null;
  if (pronWeight !== 1) notes.push(`pronunciation weight ${Math.round(pronWeight * 100) / 100}`);
  let baseScore = result.score_percent;
  if (rules.baseScore === "axis-mean" && axisMean !== null) {
    baseScore = Math.round(axisMeanToScore(axisMean, rules.axisCurve));
    if (baseScore !== result.score_percent) notes.push(`base ${result.score_percent}→${baseScore} (axis mean ${Math.round(axisMean * 100) / 100})`);
  }

  let score = baseScore;
  const bonus = rules.bonus;
  if (bonus && present.filter((v) => v >= bonus.axisThreshold).length >= bonus.minAxes) {
    score = Math.min(100, Math.round(baseScore * (1 + bonus.pct / 100)));
    if (score !== baseScore) notes.push(`+${bonus.pct}% bonus`);
  }

  const f = rules.c2Floor;
  if (f && score < f.floor && evidence.answers !== null && evidence.wordsPerAnswer !== null) {
    const strong = present.filter((v) => v >= f.axisHigh).length >= f.minAxesHigh;
    const noWeak = present.every((v) => v >= f.noAxisBelow);
    if (strong && noWeak && evidence.answers >= f.minAnswers && evidence.wordsPerAnswer >= f.minWordsPerAnswer) {
      score = f.floor;
      notes.push(`C2 floor ${f.floor}`);
    }
  }

  const bc = result.boundary_checks;
  const floors = rules.levelFloors;
  if (rules.boundaryCheck !== "off" && bc && baseLevelOf(score, floors) === bc.from) {
    if (bc.up?.decision === "upper") {
      score = Math.max(score, floors[bc.up.upper as ScoredLevel]);
      notes.push(`boundary check → ${bc.up.upper} (${score})`);
    } else if (rules.boundaryCheck === "both" && bc.down?.decision === "lower") {
      score = Math.min(score, floors[bc.from as ScoredLevel] - 1);
      notes.push(`boundary check → ${bc.down.lower} (${score})`);
    }
  }

  const g = rules.c2Gate;
  if (g) {
    const missing: string[] = [];
    if (g.maxSpeakerErrors !== null) {
      if (evidence.speakerErrors === null) missing.push("no error count");
      else if (evidence.speakerErrors > g.maxSpeakerErrors) missing.push(`${evidence.speakerErrors} errors > ${g.maxSpeakerErrors}`);
    }
    if (evidence.c2AnswersWell === null) missing.push("no C2-question evidence");
    else if (evidence.c2AnswersWell < g.minC2AnswersWell) missing.push(`${evidence.c2AnswersWell} C2 answers "well" < ${g.minC2AnswersWell}`);
    if (missing.length && score > g.cap) {
      score = g.cap;
      notes.push(`C2 gate → ${g.cap} (${missing.join(", ")})`);
    } else if (!missing.length && g.liftFromAxisMean !== null && axisMean !== null && axisMean >= g.liftFromAxisMean && score <= g.cap) {
      score = g.cap + 1;
      notes.push(`C2 by evidence → ${score} (${evidence.c2AnswersWell} C2 answers "well", ${evidence.speakerErrors} errors, axis mean ${Math.round(axisMean * 100) / 100})`);
    }
  }

  let topOfScale = false;
  const c = rules.ceiling;
  if (c) {
    if (score > c.cap) {
      notes.push(`capped at ${scoreToLevel(c.cap, floors)} (${score} → ${c.cap})`);
      score = c.cap;
    }
    const t = c.topOfScale;
    if (scoreToLevel(score, floors) === scoreToLevel(c.cap, floors) && evidence.c2AnswersWell !== null && evidence.c2AnswersWell >= t.minC2AnswersWell && axisMean !== null && axisMean >= t.minAxisMean) {
      topOfScale = true;
      notes.push(`top of scale (${evidence.c2AnswersWell} C2 answers "well", axis mean ${Math.round(axisMean * 100) / 100})`);
    }
  }

  // The evaluator's own level label is kept only when nothing moved its number
  // and the bands are the ones it was told (DEFAULT_LEVEL_FLOORS) — and never
  // a "C2" label on a score outside the C2 band (the gate's / ceiling's job).
  const kept = score === result.score_percent && isDefaultFloors(floors) ? result.level : undefined;
  const level = kept && !(kept === "C2" && scoreToLevel(score, floors) !== "C2") ? kept : scoreToLevel(score, floors);
  return { score, level, notes, ...(topOfScale ? { topOfScale } : {}) };
}

/**
 * "Our" global score for a session: the evaluator's four dimensions
 * (pronunciation from our own audio engine, fluency/vocabulary_grammar/
 * communication from the LLM, the last three in half points) combined by
 * `SCORING_RULES` — mean of the axes through the axis curve, with C2 held
 * back unless the evidence gate passes. Single source of
 * truth for "our global score", shared by the live CefrPanel display and the
 * Speechace comparison — anywhere the app needs to say "here is our one
 * overall number" it should call this rather than reading
 * `result.score_percent` directly, which is the LLM's holistic number alone.
 */
/** The level the boundary checks start from: today's rules with the checks themselves left out. */
export function levelBeforeBoundaryChecks(result: CefrResult, pronunciationAvg: Pick<PronunciationAvg, "pronunciation" | "wpm"> | null): string {
  return scoreWithRules(result, pronunciationAvg as PronunciationAvg | null, { ...SCORING_RULES, boundaryCheck: "off" }).level;
}

export function computeCompositeCefrScore(
  result: CefrResult,
  pronunciationAvg: PronunciationAvg | null,
  rules: ScoringRules = SCORING_RULES,
): CompositeCefrScore {
  const { score, level, topOfScale } = scoreWithRules(result, pronunciationAvg, rules);
  return { score, level, ...(topOfScale ? { topOfScale } : {}) };
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
export function computeSessionMainScore(session: ScorableSession, rules: ScoringRules = SCORING_RULES): SessionMainScore | null {
  const cefrResult = resolveCefrResult(session);
  if (cefrResult) {
    return { ...computeCompositeCefrScore(cefrResult, session.pronunciation_scores, rules), source: "cefr" };
  }
  if (session.global_score != null && session.cefr_level) {
    return { score: session.global_score, level: session.cefr_level, source: "cefr" };
  }
  if (session.speechace_scores?.overall != null) {
    const score = Math.round(session.speechace_scores.overall);
    // The level ELAO actually gave (its export, scripts/calibration-set.ts) — our bands put Speechace's 90 at C2 where ELAO says C1.
    const reference = session.speechace_scores.reference?.oral_level?.replace(/\s*\(.*\)|\.\d+/g, "").trim();
    return { score, level: reference || scoreToLevel(score, rules.levelFloors), source: "speechace" };
  }
  if (session.pronunciation_scores?.score != null) {
    const score = Math.round(session.pronunciation_scores.score);
    return { score, level: scoreToLevel(score, rules.levelFloors), source: "pronunciation" };
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
