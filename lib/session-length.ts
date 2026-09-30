/**
 * Adaptive session length (Track AC, doc/client-feedback-plan.md) — decides,
 * from the difficulty ladder ET drives (lib/level-assessment.ts), whether the
 * candidate's level has settled enough to end the conversation early, or
 * whether it's still moving and the session should run on (up to a max).
 *
 * Pure and dependency-free apart from the rung ladder, so the same rule runs
 * live in app/page.tsx and offline in a replay script over stored
 * `sessions.ladder_json` rows — calibration only ever changes the constants
 * below, never the call sites.
 */

import { CEFR_LADDER, type CefrRung } from "@/lib/cefr-rung";

/**
 * - "fixed": today's behaviour — one fixed length, nothing recorded beyond the ladder.
 * - "shadow": fixed length, but the stop rule runs and its "would have stopped
 *   at X with level Y" is stored, for calibration.
 * - "adaptive": the stop rule actually ends the session (between min and max).
 */
export type SessionLengthMode = "fixed" | "shadow" | "adaptive";

/** One ET result: the rung the question was asked at, the verdict, and where the ladder went next. */
export interface LadderStep {
  /** Session clock when the ET result arrived. */
  atSeconds: number;
  rung: CefrRung;
  verdict: string;
  nextRung: CefrRung;
  /** Word count of the answer that was judged. */
  words: number;
}

export type StopReason = "bracketed" | "plateau" | "ceiling" | "floor";

export interface StopDecision {
  converged: boolean;
  estimatedLevel: CefrRung | null;
  /** Which rule fired, or why a rule that fired was held back by an evidence gate. */
  reason: StopReason | "not_converged" | "too_few_answers" | "no_long_answer";
}

/** What gets stored in sessions.ladder_json (migration 0011). */
export interface LadderRecord {
  mode: SessionLengthMode;
  minSeconds: number;
  maxSeconds: number;
  steps: LadderStep[];
  /** Session clock at which an adaptive session would have closed (settled past the minimum, or hit the maximum) — null if the session ended first. */
  wouldStopAt: number | null;
  estimatedLevel: CefrRung | null;
  /** The rule that fired; "max_reached" = hit the cap unsettled; otherwise the latest not-settled reason. */
  reason: StopDecision["reason"] | "max_reached" | null;
}

// ─── Thresholds (calibrate here) ─────────────────────────────────────────────

/** Bracketed: look at this many latest steps… */
const BRACKET_WINDOW = 4;
/** …which must stay within this many rungs of each other (1 = two adjacent rungs)… */
const BRACKET_MAX_SPAN = 1;
/** …with at least this many up/down direction changes. */
const BRACKET_MIN_REVERSALS = 2;
/** Plateau: this many consecutive "adequate" at the same rung. */
const PLATEAU_RUN = 3;
/** Ceiling / floor: this many consecutive "well" at C2, or non-"well" at A1. */
const EDGE_RUN = 2;
/** Evidence gate: never stop on fewer judged answers than this. */
const MIN_ANSWERS = 5;
/** Evidence gate for an estimate ≥ B2: at least one answer this long at or above the estimate. */
const LONG_ANSWER_WORDS = 25;
const LONG_ANSWER_FROM: CefrRung = "B2";

const idx = (r: CefrRung) => CEFR_LADDER.indexOf(r);

function direction(step: LadderStep): number {
  return Math.sign(idx(step.nextRung) - idx(step.rung));
}

function detect(steps: LadderStep[]): { reason: StopReason; level: CefrRung } | null {
  const last = (n: number) => steps.slice(-n);

  const edge = last(EDGE_RUN);
  if (edge.length === EDGE_RUN) {
    if (edge.every((s) => s.rung === "C2" && s.verdict === "well")) return { reason: "ceiling", level: "C2" };
    if (edge.every((s) => s.rung === "A1" && s.verdict !== "well")) return { reason: "floor", level: "A1" };
  }

  const plateau = last(PLATEAU_RUN);
  if (plateau.length === PLATEAU_RUN && plateau.every((s) => s.verdict === "adequate" && s.rung === plateau[0].rung)) {
    return { reason: "plateau", level: plateau[0].rung };
  }

  const window = last(BRACKET_WINDOW);
  if (window.length === BRACKET_WINDOW) {
    const rungs = window.map((s) => idx(s.rung));
    if (Math.max(...rungs) - Math.min(...rungs) <= BRACKET_MAX_SPAN) {
      const moves = window.map(direction).filter((d) => d !== 0);
      let reversals = 0;
      for (let i = 1; i < moves.length; i++) if (moves[i] !== moves[i - 1]) reversals++;
      if (reversals >= BRACKET_MIN_REVERSALS) {
        // The highest rung the candidate handled "well" — the bracket's floor.
        const wellRungs = window.filter((s) => s.verdict === "well").map((s) => idx(s.rung));
        const level = CEFR_LADDER[wellRungs.length ? Math.max(...wellRungs) : Math.min(...rungs)];
        return { reason: "bracketed", level };
      }
    }
  }
  return null;
}

/** Has the level settled, and at what? Time bounds are applied by shouldCloseSession, not here. */
export function evaluateStop(steps: LadderStep[]): StopDecision {
  const hit = detect(steps);
  if (!hit) return { converged: false, estimatedLevel: null, reason: "not_converged" };
  if (steps.length < MIN_ANSWERS) return { converged: false, estimatedLevel: hit.level, reason: "too_few_answers" };
  if (idx(hit.level) >= idx(LONG_ANSWER_FROM)) {
    const hasLong = steps.some((s) => idx(s.rung) >= idx(hit.level) && s.words >= LONG_ANSWER_WORDS);
    if (!hasLong) return { converged: false, estimatedLevel: hit.level, reason: "no_long_answer" };
  }
  return { converged: true, estimatedLevel: hit.level, reason: hit.reason };
}

/**
 * Should the conversation start winding down now? "fixed"/"shadow" end at
 * `fixedSeconds` only; "adaptive" ends once converged past `minSeconds`, and
 * always at `maxSeconds`.
 */
export function shouldCloseSession(params: {
  mode: SessionLengthMode;
  elapsedSeconds: number;
  converged: boolean;
  fixedSeconds: number;
  minSeconds: number;
  maxSeconds: number;
}): boolean {
  const { mode, elapsedSeconds, converged, fixedSeconds, minSeconds, maxSeconds } = params;
  if (mode !== "adaptive") return elapsedSeconds >= fixedSeconds;
  return elapsedSeconds >= maxSeconds || (converged && elapsedSeconds >= minSeconds);
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}
