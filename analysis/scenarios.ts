/**
 * Named "what if" scenarios: each is a partial override of the LIVE rules
 * (`SCORING_RULES` in lib/cefr-score.ts). Add yours here, then run
 * `npm run analysis:scoring -- --scenario <name>`. Scenarios can be stacked
 * with a comma: `--scenario llm-base,bonus-8.5` (overrides are merged left to
 * right). A scenario that has been shipped becomes redundant — delete it.
 */
import type { ScoringRules } from "./lib/rules";

export interface Scenario {
  description: string;
  overrides: Partial<Omit<ScoringRules, "bonus">> & { bonus?: Partial<ScoringRules["bonus"]> };
  /** Where the idea comes from (doc/client-feedback-plan.md). */
  ref?: string;
}

export const SCENARIOS: Record<string, Scenario> = {
  "llm-base": {
    description: "Go back to the evaluator's holistic score_percent as the base score (what the app did before 2026-10-08).",
    ref: "Track V finding 5",
    overrides: { baseScore: "llm" },
  },
  "no-floor": {
    description: "Switch the C2 floor off.",
    ref: "Track V",
    overrides: { c2Floor: null },
  },
  "floor-looser": {
    description: "C2 floor needing only 2 of 4 axes ≥ 9 and 15 words per answer (looser).",
    ref: "Track V",
    overrides: { c2Floor: { floor: 90, minAxesHigh: 2, axisHigh: 9, noAxisBelow: 8, minAnswers: 5, minWordsPerAnswer: 15 } },
  },
  "no-wpm-fluency": {
    description: "Do not enforce the WPM → fluency table: keep the LLM's fluency axis as it scored it.",
    ref: "AB-07",
    overrides: { fluencyFromWpm: false },
  },
  "bonus-8.5": {
    description: "The +5 % bonus counts an axis from 8.5 instead of 9 (half-point axes).",
    ref: "AE-03",
    overrides: { bonus: { axisThreshold: 8.5 } },
  },
  "bonus-3-axes": {
    description: "The +5 % bonus needs 3 axes ≥ 9 instead of 2 (stricter).",
    overrides: { bonus: { minAxes: 3 } },
  },
  "no-bonus": {
    description: "Switch the +5 % bonus off.",
    overrides: { bonus: { pct: 0 } },
  },
};
