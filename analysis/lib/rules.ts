/**
 * The replay uses the LIVE scoring engine (`scoreWithRules` in
 * lib/cefr-score.ts), so a what-if can never drift from what the app does:
 * `PRODUCTION_RULES` IS `SCORING_RULES`. A scenario only overrides some fields.
 */
import { SCORING_RULES, scoreWithRules as liveScoreWithRules, type ScoreOutcome, type ScoringRules } from "../../lib/cefr-score";
import type { CefrResult, PronunciationAvg } from "../../lib/types";

export type { ScoreOutcome, ScoringRules };
export const PRODUCTION_RULES: ScoringRules = SCORING_RULES;

/** What one stored session gives the replay — everything is read from the database, nothing is re-run. */
export interface SessionFacts {
  id: string;
  language: string | null;
  createdAt: string;
  storedLevel: string | null;
  evaluation: CefrResult;
  pronunciation: PronunciationAvg | null;
  /** Answer evidence stamped on the evaluation (null for sessions evaluated before 2026-10-08). */
  storedEvidence: { answers: number; wordsPerAnswer: number } | null;
  /** The same figures recomputed from session_turns — available for every session. */
  turnEvidence: { answers: number; wordsPerAnswer: number };
}

export type EvidenceSource = "stored" | "turns";

export function scoreSession(facts: SessionFacts, rules: ScoringRules, evidence: EvidenceSource): ScoreOutcome {
  const e = evidence === "turns" ? facts.turnEvidence : facts.storedEvidence;
  return liveScoreWithRules(facts.evaluation, facts.pronunciation, rules, {
    answers: e?.answers ?? null,
    wordsPerAnswer: e?.wordsPerAnswer ?? null,
  });
}
