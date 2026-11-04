/**
 * Response timing and light integrity signals
 * (doc/feature-2-response-timing-and-integrity.md).
 *
 * The live page records raw facts per question (lib/integrity-tracker.ts) and
 * stores them as sessions.integrity_json; the reviewer-facing summary is
 * computed from those facts at READ time with the current settings, so a
 * threshold change applies to past sessions too and nothing about the score
 * ever depends on it. A hint for reviewers, never a verdict: no score change,
 * no automatic rejection.
 *
 * Client-safe: no server-only import (app/page.tsx and the admin pages both use it).
 */

import { isCefrRung, type CefrRung } from "@/lib/cefr-rung";

/** One avatar question and what happened before the candidate answered it. */
export interface QuestionTiming {
  /** 0-based order of the question in the session. */
  index: number;
  /** Question bank id, when the bank picked it. */
  questionId: string | null;
  /** Rung the question was asked at — picks the silence threshold band. */
  rung: CefrRung;
  /** When the avatar finished asking (ms since session start); the last time, if it was repeated. Null = never finished. */
  askedEndMs: number | null;
  /** Avatar end → start of the candidate's (confirmed) speech. 0 on a barge-in. Null = no answer. */
  latencyMs: number | null;
  /** Spoken duration of the first answer segment. */
  answerMs: number | null;
  /** Time spent outside the test window while this question was open. */
  awayMs: number;
  /** Opening question of the session — never counted (warm-up). */
  warmup?: boolean;
  /** Re-ask after a "didn't understand" — never counted. */
  reask?: boolean;
  /** "Je ne comprends pas" pressed on this question — never counted. */
  clarify?: boolean;
  /** "Répéter la question" used — latency is measured from the end of the replay. */
  repeat?: boolean;
  /** "Passer" — no answer, counted separately. */
  skipped?: boolean;
  /** Candidate started speaking before the avatar finished. */
  bargeIn?: boolean;
  /** Mic lost, examiner error or an answer heard as nothing — never counted. */
  techIssue?: boolean;
}

/** A spell outside the test window (tab hidden or window unfocused), at least MIN_AWAY_MS long. */
export interface WindowEvent {
  /** "tab" = the page was hidden (tab switch, minimised); "window" = it stayed visible but lost focus (another app or window). */
  kind: "tab" | "window";
  /** Start, ms since session start. */
  atMs: number;
  awayMs: number;
  /** Question open at the time, if any. */
  question: number | null;
}

/** Stored as sessions.integrity_json (migration 0016). */
export interface IntegrityRecord {
  version: 1;
  questions: QuestionTiming[];
  windowEvents: WindowEvent[];
}

/** Away spells shorter than this (OS notifications, permission prompts) are not recorded. */
export const MIN_AWAY_MS = 1000;

/** Admin-editable (integrity_settings, /admin/settings). */
export interface IntegritySettings {
  /** Off = no tracking, no intro line, no message on return. */
  enabled: boolean;
  /** A latency above this (seconds) is a long silence, by the question's level band. */
  silenceThresholdSec: Record<LevelBand, number>;
  /** Long silences on at least this many questions raise the silence signal. */
  minLongSilences: number;
  /** At least this many window changes, or minAwaySec away in total, raise the window signal. */
  minWindowChanges: number;
  minAwaySec: number;
}

export type LevelBand = "A" | "B" | "C";

/** The spec's starting values — guesses until tuned on the pilots' sessions. */
export const DEFAULT_INTEGRITY_SETTINGS: IntegritySettings = {
  enabled: true,
  silenceThresholdSec: { A: 6, B: 4, C: 3 },
  minLongSilences: 3,
  minWindowChanges: 2,
  minAwaySec: 30,
};

/**
 * Questions where the candidate both left the window and then answered after
 * a long silence: at least this many → "high" on their own. Fixed rather than
 * a setting: it is the combination the feature exists for.
 */
const LINKED_QUESTIONS_FOR_HIGH = 2;

export function levelBand(rung: CefrRung): LevelBand {
  return rung.charAt(0) as LevelBand;
}

/** Merges a stored (possibly partial or older) settings object over the defaults. */
export function normalizeIntegritySettings(raw: unknown): IntegritySettings {
  const d = DEFAULT_INTEGRITY_SETTINGS;
  if (!raw || typeof raw !== "object") return d;
  const r = raw as Partial<IntegritySettings>;
  const num = (v: unknown, fallback: number, min: number, max: number) =>
    typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : fallback;
  const t = (r.silenceThresholdSec ?? {}) as Partial<Record<LevelBand, number>>;
  return {
    enabled: typeof r.enabled === "boolean" ? r.enabled : d.enabled,
    silenceThresholdSec: {
      A: num(t.A, d.silenceThresholdSec.A, 1, 60),
      B: num(t.B, d.silenceThresholdSec.B, 1, 60),
      C: num(t.C, d.silenceThresholdSec.C, 1, 60),
    },
    minLongSilences: Math.round(num(r.minLongSilences, d.minLongSilences, 1, 50)),
    minWindowChanges: Math.round(num(r.minWindowChanges, d.minWindowChanges, 1, 50)),
    minAwaySec: num(r.minAwaySec, d.minAwaySec, 1, 3600),
  };
}

/**
 * sessions.integrity_json comes from public endpoints (the live save and the
 * final save) — keep only well-formed entries, bounded in number; it's
 * diagnostic data, so anything else is just dropped.
 */
export function sanitizeIntegrity(raw: unknown): IntegrityRecord | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as { questions?: unknown; windowEvents?: unknown };
  if (!Array.isArray(r.questions) || !Array.isArray(r.windowEvents)) return null;
  const ms = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);
  const flag = (v: unknown) => (v === true ? true : undefined);

  const questions: QuestionTiming[] = [];
  for (const q of r.questions.slice(0, 200) as Array<Record<string, unknown>>) {
    if (!q || typeof q !== "object" || !isCefrRung(q.rung) || ms(q.index) === null) continue;
    questions.push({
      index: ms(q.index)!,
      questionId: typeof q.questionId === "string" ? q.questionId.slice(0, 100) : null,
      rung: q.rung,
      askedEndMs: ms(q.askedEndMs),
      latencyMs: ms(q.latencyMs),
      answerMs: ms(q.answerMs),
      awayMs: ms(q.awayMs) ?? 0,
      warmup: flag(q.warmup),
      reask: flag(q.reask),
      clarify: flag(q.clarify),
      repeat: flag(q.repeat),
      skipped: flag(q.skipped),
      bargeIn: flag(q.bargeIn),
      techIssue: flag(q.techIssue),
    });
  }
  const windowEvents: WindowEvent[] = [];
  for (const e of r.windowEvents.slice(0, 500) as Array<Record<string, unknown>>) {
    if (!e || typeof e !== "object" || (e.kind !== "tab" && e.kind !== "window")) continue;
    const atMs = ms(e.atMs);
    const awayMs = ms(e.awayMs);
    if (atMs === null || awayMs === null) continue;
    windowEvents.push({ kind: e.kind, atMs, awayMs, question: ms(e.question) });
  }
  return { version: 1, questions, windowEvents };
}

/** Whether a question's latency can count as a long silence at all (spec "rules to avoid false positives"). */
export function isCountedQuestion(q: QuestionTiming): boolean {
  return !q.warmup && !q.reask && !q.clarify && !q.techIssue && !q.skipped && q.latencyMs !== null;
}

export function isLongSilence(q: QuestionTiming, settings: IntegritySettings): boolean {
  return isCountedQuestion(q) && q.latencyMs! > settings.silenceThresholdSec[levelBand(q.rung)] * 1000;
}

export type IntegrityLevel = "none" | "low" | "high";

export interface IntegritySummary {
  level: IntegrityLevel;
  /** Plain-language reasons, empty when level is "none". */
  reasons: string[];
  countedQuestions: number;
  longSilences: number;
  skipped: number;
  windowChanges: number;
  awaySec: number;
  /** Questions with both time away and a long silence. */
  linkedQuestions: number;
}

/**
 * none / low / high, with the reasons listed:
 *   - silence signal: long silences on ≥ minLongSilences counted questions
 *   - window signal: ≥ minWindowChanges window changes, or ≥ minAwaySec away in total
 *   - high = both signals, or ≥ LINKED_QUESTIONS_FOR_HIGH questions where the
 *     candidate left the window and then answered after a long silence;
 *     low = one signal.
 */
export function summarizeIntegrity(record: IntegrityRecord, settings: IntegritySettings): IntegritySummary {
  const counted = record.questions.filter(isCountedQuestion);
  const long = counted.filter((q) => isLongSilence(q, settings));
  const linked = long.filter((q) => q.awayMs >= MIN_AWAY_MS);
  const skipped = record.questions.filter((q) => q.skipped).length;
  const windowChanges = record.windowEvents.length;
  const awaySec = Math.round(record.windowEvents.reduce((s, e) => s + e.awayMs, 0) / 1000);

  const silenceSignal = long.length >= settings.minLongSilences;
  const windowSignal = windowChanges >= settings.minWindowChanges || (windowChanges > 0 && awaySec >= settings.minAwaySec);
  const linkedSignal = linked.length >= LINKED_QUESTIONS_FOR_HIGH;

  const reasons: string[] = [];
  if (silenceSignal) {
    const t = settings.silenceThresholdSec;
    reasons.push(`${long.length} long silences on ${counted.length} questions (over ${t.A} s at A, ${t.B} s at B, ${t.C} s at C)`);
  }
  if (windowSignal) {
    reasons.push(`${windowChanges} window change${windowChanges === 1 ? "" : "s"}, ${awaySec} s away in total`);
  }
  if (linkedSignal) {
    reasons.push(`${linked.length} questions answered after leaving the window and a long silence`);
  }

  const level: IntegrityLevel = (silenceSignal && windowSignal) || linkedSignal ? "high" : silenceSignal || windowSignal ? "low" : "none";
  return {
    level,
    reasons,
    countedQuestions: counted.length,
    longSilences: long.length,
    skipped,
    windowChanges,
    awaySec,
    linkedQuestions: linked.length,
  };
}
