/**
 * Named "what if" scenarios: each is a partial override of the LIVE rules
 * (`SCORING_RULES` in lib/cefr-score.ts). Add yours here, then run
 * `npm run analysis:scoring -- --scenario <name>`. Scenarios can be stacked
 * with a comma: `--scenario linear-axes,with-bonus` (overrides are merged left
 * to right; each field is replaced whole). A scenario that has been shipped
 * becomes redundant — delete it.
 */
import type { ScoringRules } from "./lib/rules";

export interface Scenario {
  description: string;
  overrides: Partial<ScoringRules>;
  /** Where the idea comes from (doc/client-feedback-plan.md). */
  ref?: string;
}

const OLD_BONUS: ScoringRules["bonus"] = { minAxes: 2, axisThreshold: 9, pct: 5 };
const OLD_FLOOR: ScoringRules["c2Floor"] = { floor: 90, minAxesHigh: 3, axisHigh: 9, noAxisBelow: 8, minAnswers: 5, minWordsPerAnswer: 20 };

export const SCENARIOS: Record<string, Scenario> = {
  "before-2026-10-14": {
    description: "The rules live 2026-10-08 → 2026-10-14: axis mean × 10, +5 % bonus, C2 floor, WPM band raises fluency, no C2 gate.",
    overrides: { axisCurve: null, fluencyFromWpm: "band", bonus: OLD_BONUS, c2Floor: OLD_FLOOR, c2Gate: null, ceiling: null },
  },
  "show-c2": {
    description: "Report C2 again (the 2026-10-14 → 18 rules): no C1+ ceiling; C2 by evidence (≥ 2 C2 answers \"well\", ≤ 2 errors, axis mean ≥ 8.75), held at C1+ without it.",
    overrides: { ceiling: null, c2Gate: { maxSpeakerErrors: 2, minC2AnswersWell: 2, cap: 89, liftFromAxisMean: 8.75 } },
  },
  "llm-base": {
    description: "Go back to the evaluator's holistic score_percent as the base score (what the app did before 2026-10-08).",
    ref: "Track V finding 5",
    overrides: { baseScore: "llm" },
  },
  "linear-axes": {
    description: "Axis mean × 10 instead of the curve (a mean of 9 is C2 again).",
    overrides: { axisCurve: null },
  },
  "with-bonus": {
    description: "Bring back the +5 % bonus (2 axes ≥ 9).",
    overrides: { bonus: OLD_BONUS },
  },
  "with-floor": {
    description: "Bring back the C2 floor (3 axes ≥ 9, none < 8, ≥ 5 answers, ≥ 20 words per answer → 90).",
    ref: "Track V",
    overrides: { c2Floor: OLD_FLOOR },
  },
  "boundary-up": {
    description: "Apply the upward boundary check: both runs say 'the level above' → that level's floor.",
    overrides: { boundaryCheck: "up" },
  },
  "boundary-both": {
    description: "Apply the boundary checks both ways (up first; else down when both runs say 'the level below').",
    overrides: { boundaryCheck: "both" },
  },
  "wpm-band": {
    description: "The speaking rate also raises fluency into its band (AB-07 as shipped 2026-10-08), not only caps it.",
    ref: "AB-07",
    overrides: { fluencyFromWpm: "band" },
  },
  "pron-stretch": {
    description: "Pronunciation curve: the engines' squeezed 65–85 range stretched over the axis (65 → 5, 78 → 7, 85 → 9, 92 → 10).",
    ref: "calibration 2026-10-14",
    overrides: { pronunciationCurve: [[40, 1], [65, 5], [78, 7], [85, 9], [92, 10]] },
  },
  "pron-linear": {
    description: "Pronunciation curve: a straight stretch, 50 → 0 and 90 → 10 (70 → 5, 80 → 7.5).",
    ref: "calibration 2026-10-14",
    overrides: { pronunciationCurve: [[50, 0], [90, 10]] },
  },
  "pron-soft": {
    description: "Pronunciation curve: a milder stretch (60 → 5, 80 → 8, 90 → 9.5, 95 → 10).",
    ref: "calibration 2026-10-14",
    overrides: { pronunciationCurve: [[0, 0], [60, 5], [80, 8], [90, 9.5], [95, 10]] },
  },
  "no-wpm-fluency": {
    description: "Ignore the speaking rate: keep the LLM's fluency axis as it scored it.",
    ref: "AB-07",
    overrides: { fluencyFromWpm: "off" },
  },
};
