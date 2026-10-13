/**
 * Shared core of the simulation scripts (scripts/sim-batch.ts, scripts/sim-matrix.ts):
 * Mistral pacing, console muting, playing one simulated session into a flat
 * record, and the per-batch metrics. See sim-batch.ts for what a simulation is
 * and isn't worth.
 */

import { runConversationSimulation, type SimConfig, type SimEvent, type Understanding } from "@/lib/conversation-sim";
import type { ConvLang } from "@/lib/conversation-prompts";
import { CEFR_LADDER, type CefrRung } from "@/lib/cefr-rung";
import type { StopDecision } from "@/lib/session-length";
import type { SimAudioProxy } from "@/lib/sim-audio-proxy";
import { buildSimulationRecord } from "@/lib/simulation-record";
import { saveSimulationSession } from "@/lib/sessions-service";

// ─── console noise: the lib logs every LLM call, mute it and print our own progress ──

const real = { log: console.log, info: console.info, warn: console.warn, error: console.error };

export function muteConsole() {
  console.log = () => {};
  console.info = () => {};
  console.warn = () => {};
  console.error = () => {};
}

export function restoreConsole() {
  Object.assign(console, real);
}

export const say = (msg: string) => process.stderr.write(msg + "\n");

// ─── Mistral pacing ──────────────────────────────────────────────────────────
// Mistral allows ~30 requests/minute on this key and a session makes ~35 LLM
// calls, so parallel sessions blow through it (the lib's own 3 quick retries
// don't outlast a 429 window and the session dies). Every request to Mistral
// goes through one global slot scheduler (≈ 26/min), and a 429 waits and retries.

export function installMistralPacing() {
  const MIN_GAP_MS = Number(process.env.SIM_MISTRAL_GAP_MS ?? 2300);
  let nextSlot = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.includes("api.mistral.ai")) return realFetch(input, init);
    for (let attempt = 1; ; attempt++) {
      const now = Date.now();
      const slot = Math.max(now, nextSlot);
      nextSlot = slot + MIN_GAP_MS;
      if (slot > now) await new Promise((r) => setTimeout(r, slot - now));
      const res = await realFetch(input, init);
      if (res.status !== 429 || attempt >= 6) return res;
      await new Promise((r) => setTimeout(r, 15000 * attempt));
    }
  }) as typeof fetch;
}

// ─── types ───────────────────────────────────────────────────────────────────

export interface TurnRecord {
  turn: number;
  /** Rung the examiner targeted for this question. */
  rung: CefrRung;
  question: string;
  questionWords: number;
  questionMarks: number;
  understanding: Understanding | null; // null above A2 (no listening simulation)
  heard: string | null;
  answer: string;
  answerWords: number;
  verdict: string | null;
  nextRung: CefrRung | null;
}

export interface SessionRecord {
  language: ConvLang;
  /** Simulated learner level. */
  level: CefrRung;
  persona: string;
  turns: TurnRecord[];
  rungPath: CefrRung[];
  /** The examiner's closing turn (after the last answer). */
  closing: string | null;
  finalLevel: string | null;
  finalScore: number | null;
  axes: { fluency: number | null; vocabulary_grammar: number | null; communication: number | null } | null;
  confidence: string | null;
  summary: string | null;
  /** With an audio proxy: the evaluation of the same answers without it. */
  finalLevelTextOnly: string | null;
  finalScoreTextOnly: number | null;
  audioProxy: SimAudioProxy | null;
  /** Adaptive length: where and why the stop rule ended the session. */
  stop: { turn: number; decision: StopDecision; capped: boolean } | null;
  errors: string[];
  durationMs: number;
  /** sessions.id of the saved copy (null when not saved or if saving failed). */
  savedId: string | null;
}

export function emptySession(language: ConvLang, level: CefrRung, error?: string): SessionRecord {
  return {
    language, level, persona: "", turns: [], rungPath: [], closing: null, finalLevel: null, finalScore: null,
    axes: null, confidence: null, summary: null, finalLevelTextOnly: null, finalScoreTextOnly: null,
    audioProxy: null, stop: null, errors: error ? [error] : [], durationMs: 0, savedId: null,
  };
}

// ─── one session ─────────────────────────────────────────────────────────────

export async function playSession(
  config: SimConfig,
  opts: { save: boolean; batchId: string; label: string | null },
): Promise<SessionRecord> {
  const rec = emptySession(config.language, config.learnerLevel);
  rec.audioProxy = config.audioProxy ?? null;
  const events: SimEvent[] = [];
  // The examiner event for turn N is the question the learner answers in turn N+1.
  let pending: { rung: CefrRung; text: string } | null = null;
  let current: TurnRecord | null = null;

  for await (const e of runConversationSimulation(config) as AsyncGenerator<SimEvent>) {
    events.push(e);
    switch (e.type) {
      case "start":
        rec.persona = `${e.persona.name}, ${e.persona.age}, ${e.persona.job}`;
        break;
      case "examiner":
        if (!e.closing) {
          pending = { rung: e.rung, text: e.text };
          rec.rungPath.push(e.rung);
        } else {
          rec.closing = e.text;
        }
        break;
      case "learner": {
        if (!pending) break;
        current = {
          turn: e.turn,
          rung: pending.rung,
          question: pending.text,
          questionWords: pending.text.split(/\s+/).filter(Boolean).length,
          questionMarks: (pending.text.match(/\?/g) ?? []).length,
          understanding: e.understanding ?? null,
          heard: e.heard ?? null,
          answer: e.text,
          answerWords: e.text.split(/\s+/).filter(Boolean).length,
          verdict: null,
          nextRung: null,
        };
        rec.turns.push(current);
        break;
      }
      case "et":
        if (current && current.turn === e.turn) {
          current.verdict = e.verdict;
          current.nextRung = e.nextRung;
        }
        break;
      case "stop":
        rec.stop = { turn: e.turn, decision: e.decision, capped: e.capped };
        break;
      case "evaluation": {
        const r = e.result;
        rec.finalLevel = e.composite.level;
        rec.finalScore = e.composite.score;
        rec.axes = { fluency: r.dimensions.fluency, vocabulary_grammar: r.dimensions.vocabulary_grammar, communication: r.dimensions.communication };
        rec.confidence = r.confidence;
        rec.summary = r.summary;
        if (e.textOnly) {
          rec.finalLevelTextOnly = e.textOnly.composite.level;
          rec.finalScoreTextOnly = e.textOnly.composite.score;
        }
        break;
      }
      case "error":
        rec.errors.push(`${e.stage}: ${e.message}`);
        break;
      case "done":
        rec.durationMs = e.durationMs;
        break;
    }
  }
  if (opts.save && rec.finalLevel) {
    try {
      const record = buildSimulationRecord(events, { batchId: opts.batchId, label: opts.label });
      if (record) rec.savedId = (await saveSimulationSession(record)).id;
    } catch (err) {
      rec.errors.push(`save: ${String(err)}`);
    }
  }
  return rec;
}

// ─── metrics ─────────────────────────────────────────────────────────────────

export const LEVEL_ORDER = ["A0", "A1", "A1+", "A2", "A2+", "B1", "B1+", "B2", "B2+", "C1", "C1+", "C2"];
export const levelIndex = (l: string | null) => (l ? LEVEL_ORDER.indexOf(l) : -1);

export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
export const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
export const r1 = (n: number) => Math.round(n * 10) / 10;

function percentile(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

export type Summary = ReturnType<typeof summarise>;

/** `level` is the simulated learner level; the expected label is the plain rung (e.g. "A1"), ±1 label ("A1+", "A0") counts as close. */
export function summarise(sessions: SessionRecord[], level: CefrRung) {
  const targetIdx = LEVEL_ORDER.indexOf(level);
  const turns = sessions.flatMap((s) => s.turns);
  const listened = turns.filter((t) => t.understanding !== null);
  const count = (u: Understanding) => listened.filter((t) => t.understanding === u).length;
  const firstTurns = sessions.map((s) => s.turns[0]).filter(Boolean);
  const firstListened = firstTurns.filter((t) => t.understanding !== null);

  const verdicts = turns.filter((t) => t.verdict);
  const byRung = CEFR_LADDER.map((rung) => {
    const ts = turns.filter((t) => t.rung === rung);
    const lt = ts.filter((t) => t.understanding !== null);
    return {
      rung,
      questions: ts.length,
      notFullyUnderstood: lt.length ? pct(lt.filter((t) => t.understanding !== "full").length, lt.length) : null,
      avgQuestionWords: r1(mean(ts.map((t) => t.questionWords))),
    };
  }).filter((r) => r.questions > 0);

  const scored = sessions.filter((s) => s.finalLevel);
  const idx = scored.map((s) => levelIndex(s.finalLevel));
  const within = (n: number) => pct(idx.filter((i) => Math.abs(i - targetIdx) <= n).length, scored.length);
  const maxRung = (s: SessionRecord) => Math.max(...s.rungPath.map((r) => CEFR_LADDER.indexOf(r)));
  const targetRungIdx = CEFR_LADDER.indexOf(level);

  return {
    sessions: sessions.length,
    failedSessions: sessions.filter((s) => s.errors.length || !s.finalLevel).length,
    turns: turns.length,
    listening: listened.length
      ? {
          fullyUnderstoodPct: pct(count("full"), listened.length),
          partialPct: pct(count("partial"), listened.length),
          notUnderstoodPct: pct(count("none"), listened.length),
          firstQuestionNotFullyUnderstoodPct: pct(firstListened.filter((t) => t.understanding !== "full").length, firstListened.length),
          sessionsWithAnyNone: pct(sessions.filter((s) => s.turns.some((t) => t.understanding === "none")).length, sessions.length),
        }
      : null,
    questions: {
      avgWords: r1(mean(turns.map((t) => t.questionWords))),
      p90Words: percentile(turns.map((t) => t.questionWords), 90),
      over12WordsPct: pct(turns.filter((t) => t.questionWords > 12).length, turns.length),
      multiQuestionPct: pct(turns.filter((t) => t.questionMarks > 1).length, turns.length),
    },
    answers: { avgWords: r1(mean(turns.map((t) => t.answerWords))) },
    pacing: {
      verdicts: {
        well: pct(verdicts.filter((t) => t.verdict === "well").length, verdicts.length),
        adequate: pct(verdicts.filter((t) => t.verdict === "adequate").length, verdicts.length),
        struggled: pct(verdicts.filter((t) => t.verdict === "struggled").length, verdicts.length),
      },
      avgMaxRungReached: r1(mean(sessions.map((s) => (s.rungPath.length ? maxRung(s) : 0))) - targetRungIdx) + " rungs above the simulated level",
      sessionsReachingTwoAboveLevelPct: pct(sessions.filter((s) => s.rungPath.length && maxRung(s) >= targetRungIdx + 2).length, sessions.length),
    },
    byRung,
    finalLevel: {
      distribution: Object.fromEntries(LEVEL_ORDER.map((l) => [l, scored.filter((s) => s.finalLevel === l).length]).filter(([, n]) => (n as number) > 0)),
      avgScore: r1(mean(scored.map((s) => s.finalScore ?? 0))),
      exactPct: within(0),
      withinOnePlusPct: within(1),
      withinTwoPct: within(2),
      avgAxes: scored.length
        ? {
            fluency: r1(mean(scored.map((s) => s.axes?.fluency ?? 0))),
            vocabulary_grammar: r1(mean(scored.map((s) => s.axes?.vocabulary_grammar ?? 0))),
            communication: r1(mean(scored.map((s) => s.axes?.communication ?? 0))),
          }
        : null,
    },
  };
}

/** Questions the learner did not (fully) understand, worst first, with what they actually heard. */
export function problemQuestions(sessions: SessionRecord[], limit = 25) {
  const rank = (u: Understanding | null) => (u === "none" ? 2 : u === "partial" ? 1 : 0);
  return sessions
    .flatMap((s) => s.turns.map((t) => ({ language: s.language, ...t })))
    .filter((t) => rank(t.understanding) > 0)
    .sort((a, b) => rank(b.understanding) - rank(a.understanding) || b.questionWords - a.questionWords)
    .slice(0, limit)
    .map((t) => ({ rung: t.rung, understanding: t.understanding, words: t.questionWords, question: t.question, heard: t.heard, answer: t.answer }));
}

/** A session as the analyst / judge reads it. */
export function transcriptText(s: SessionRecord): string {
  return (
    `### ${s.language} · ${s.persona} · final ${s.finalLevel} (${s.finalScore}) · rungs ${s.rungPath.join("→")}\n` +
    s.turns
      .map((t) => `[Q${t.turn} · ${t.rung} · understood: ${t.understanding ?? "n/a"} · ET: ${t.verdict ?? "?"}→${t.nextRung ?? "?"}]\nExaminer: ${t.question}\n${t.heard ? `Learner heard: ${t.heard}\n` : ""}Learner: ${t.answer}`)
      .join("\n\n") +
    (s.closing ? `\n\n[closing]\nExaminer: ${s.closing}` : "")
  );
}

/** Run `fn` over `jobs` with at most `concurrency` in flight. */
export async function runPool<T>(jobs: T[], concurrency: number, fn: (job: T, i: number) => Promise<void>) {
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const i = next++;
      await fn(jobs[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
}
