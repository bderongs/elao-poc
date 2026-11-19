/**
 * Written test (MVP, /ecrit): three free productions of 50 to 100 words,
 * scored in two separate LLM passes — a neutral survey of observable
 * language facts, then bands per criterion drawn from that survey alone —
 * and a weighted aggregation with caps done in code (lib/writing/score.ts).
 * Nothing is stored in the database.
 */

export const WRITING_LANGS = ["fr", "en"] as const;
export type WritingLang = (typeof WRITING_LANGS)[number];

export function isWritingLang(v: unknown): v is WritingLang {
  return typeof v === "string" && (WRITING_LANGS as readonly string[]).includes(v);
}

/** Bands of the grid, lowest first. The index (+1) is the value used in the weighted average. */
export const BANDS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
export type Band = (typeof BANDS)[number];

export function isBand(v: unknown): v is Band {
  return typeof v === "string" && (BANDS as readonly string[]).includes(v);
}

export function bandValue(band: Band): number {
  return BANDS.indexOf(band) + 1;
}

export function bandFromValue(value: number): Band {
  return BANDS[Math.min(BANDS.length, Math.max(1, value)) - 1];
}

export const CRITERIA = ["task_adequacy", "lexical_range", "grammar", "formal_accuracy", "cohesion"] as const;
export type Criterion = (typeof CRITERIA)[number];

export interface WritingTask {
  id: string;
  /** Short title shown above the instructions. */
  title: string;
  /** The instructions, in the tested language. */
  instructions: string;
  /** The content points the instructions ask for — what "adéquation à la tâche" is checked against. */
  points: string[];
}

// ─── pass 1: the survey ("relevé") ─────────────────────────────────────────

export const FACT_CATEGORIES = [
  "subordination",
  "tenses",
  "connectors",
  "vocabulary",
  "agreement",
  "spelling",
  "punctuation",
  "pronoun_reference",
  "sentence_structure",
  "other",
] as const;
export type FactCategory = (typeof FACT_CATEGORIES)[number];

/** One observable language fact, always tied to an exact excerpt of the candidate's text. */
export interface SurveyFact {
  /** "T1-F3": text 1, fact 3 — what pass 2 cites as evidence. */
  id: string;
  category: FactCategory;
  excerpt: string;
  /** The form departs from the standard language (an error), as opposed to a form that follows it. */
  departure: boolean;
  observation: string;
}

/** A task point the text addresses, with the excerpt that addresses it. */
export interface SurveyCoverage {
  /** "T1-C2": text 1, coverage 2. */
  id: string;
  /** 1-based index into the task's points. */
  point: number;
  excerpt: string;
}

/** A passage the model had to interpret to understand the message. */
export interface SurveyInterpretation {
  id: string;
  excerpt: string;
  understoodAs: string;
}

export interface TextSurvey {
  taskId: string;
  wordCount: number;
  coverage: SurveyCoverage[];
  facts: SurveyFact[];
  interpretations: SurveyInterpretation[];
  /** What the code removed from the model's output, and why — for calibration. */
  dropped: { reason: "excerpt_not_in_text" | "appraisal_term" | "invalid"; item: string }[];
}

// ─── pass 2: bands ─────────────────────────────────────────────────────────

export interface CriterionBand {
  band: Band;
  /** The band the model gave before the code applied its rules (lowest band on hesitation, lowest band without evidence). */
  modelBand: Band | null;
  /** Survey ids the band rests on (only ids that exist in the survey are kept). */
  evidence: string[];
  /** Set when the model hesitated between bands: the lower one is kept. */
  hesitation: { between: Band[]; reason: string } | null;
  /** True when the model cited no valid evidence: the band falls to the lowest one. */
  noEvidence: boolean;
  rationale: string;
}

// ─── result ────────────────────────────────────────────────────────────────

export interface AppliedCap {
  rule: "intelligibility" | "task_adequacy" | "weakest_criterion";
  cap: Band;
  detail: string;
}

export interface WritingResult {
  language: WritingLang;
  level: Band;
  /** Weighted average of the criterion bands, 1 (A1) to 6 (C2), before caps. */
  weightedAverage: number;
  /** Level from the weighted average alone, before caps. */
  uncappedLevel: Band;
  criteria: Record<Criterion, CriterionBand>;
  caps: AppliedCap[];
  surveys: TextSurvey[];
  texts: string[];
  meta: {
    model: string;
    promptVersion: string;
    gridVersion: string;
    durationMs: number;
  };
}
