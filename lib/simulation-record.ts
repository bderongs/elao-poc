/**
 * Turns the event stream of one conversation simulation (lib/conversation-sim.ts)
 * into what gets stored: a transcript shaped like a real session's, the
 * difficulty ladder, the evaluation, and the simulation-only metadata
 * (sessions.simulation_json). Pure — safe for client and server.
 */

import type { SimConfig, SimEvent, SimPersona, Understanding } from "@/lib/conversation-sim";
import type { CefrResult } from "@/lib/types";
import type { LadderRecord } from "@/lib/session-length";
import { countWords } from "@/lib/session-length";

export interface SimulationTurnMeta {
  turn: number;
  /** Rung the examiner's question was asked at. */
  rung: string;
  /** What the learner actually caught of the question (A1/A2 listening step); absent at higher levels. */
  heard?: string;
  understanding?: Understanding;
  verdict?: string;
  nextRung?: string;
}

/** What gets stored in sessions.simulation_json (migration 0013). */
export interface SimulationJson {
  config: SimConfig;
  persona: SimPersona;
  learnerModel: string;
  examinerModel: string;
  /** Groups the sessions of one scripts/sim-batch.ts run (and of a repeat of the same run) so they can be compared. */
  batchId: string | null;
  /** Free-text tag for the run, e.g. "after step-up guard". */
  label: string | null;
  turns: SimulationTurnMeta[];
  errors: string[];
}

export interface SimulationRecord {
  language: string;
  durationMs: number;
  transcript: { role: "user" | "assistant"; content: string; pronunciation: null }[];
  evaluation: CefrResult | null;
  cefrLevel: string | null;
  globalScore: number | null;
  ladder: LadderRecord;
  simulation: SimulationJson;
}

export function buildSimulationRecord(
  events: SimEvent[],
  meta: { batchId?: string | null; label?: string | null } = {},
): SimulationRecord | null {
  const start = events.find((e): e is Extract<SimEvent, { type: "start" }> => e.type === "start");
  if (!start) return null;

  const transcript: SimulationRecord["transcript"] = [];
  const turns: SimulationTurnMeta[] = [];
  const steps: LadderRecord["steps"] = [];
  const errors: string[] = [];
  let evaluation: CefrResult | null = null;
  let cefrLevel: string | null = null;
  let globalScore: number | null = null;
  let durationMs = 0;
  let pendingRung = start.config.startingRung as string;
  let lastAnswerWords = 0;
  // Simulated session clock: no timer exists, so steps are just ordered.
  let atSeconds = 0;

  for (const e of events) {
    switch (e.type) {
      case "examiner":
        transcript.push({ role: "assistant", content: e.text, pronunciation: null });
        if (!e.closing) pendingRung = e.rung;
        break;
      case "learner":
        transcript.push({ role: "user", content: e.text, pronunciation: null });
        lastAnswerWords = countWords(e.text);
        turns.push({
          turn: e.turn,
          rung: pendingRung,
          ...(e.heard !== undefined ? { heard: e.heard } : {}),
          ...(e.understanding ? { understanding: e.understanding } : {}),
        });
        break;
      case "et": {
        const t = turns.find((x) => x.turn === e.turn);
        if (t) {
          t.verdict = e.verdict;
          t.nextRung = e.nextRung;
        }
        atSeconds += 1;
        steps.push({ atSeconds, rung: e.previousRung, verdict: e.verdict, nextRung: e.nextRung, words: lastAnswerWords });
        break;
      }
      case "evaluation":
        evaluation = e.result;
        cefrLevel = e.composite.level;
        globalScore = Math.round(e.composite.score);
        break;
      case "error":
        errors.push(`${e.stage}: ${e.message}`);
        break;
      case "done":
        durationMs = e.durationMs;
        break;
    }
  }

  return {
    language: start.config.language,
    durationMs,
    transcript,
    evaluation,
    cefrLevel,
    globalScore,
    ladder: { mode: "fixed", minSeconds: 0, maxSeconds: 0, steps, wouldStopAt: null, estimatedLevel: null, reason: null },
    simulation: {
      config: start.config,
      persona: start.persona,
      learnerModel: start.learnerModel,
      examinerModel: start.examinerModel,
      batchId: meta.batchId ?? null,
      label: meta.label ?? null,
      turns,
      errors,
    },
  };
}
