/**
 * Live-session recorder for lib/integrity.ts's IntegrityRecord — response
 * latency per question and time spent outside the test window. app/page.tsx
 * calls it at a handful of points; it decides nothing, it only records facts
 * (the summary is computed at read time, see lib/integrity.ts).
 *
 * Question lifecycle, as app/page.tsx drives it:
 *   startQuestion   handleUserTurn starts the avatar's next reply (= next question)
 *   questionAsked   the avatar actually finished speaking it (again after a repeat)
 *   answerStarted   the VAD confirmed an answer segment (≥ MIN_SPEECH_MS), with its start time
 *   mark            a button or technical problem on the open question
 *
 * Times are ms since the session started.
 */

import type { CefrRung } from "@/lib/cefr-rung";
import { MIN_AWAY_MS, type IntegrityRecord, type QuestionTiming, type WindowEvent } from "@/lib/integrity";

type QuestionFlag = "clarify" | "repeat" | "skipped" | "techIssue";

export class IntegrityTracker {
  private questions: QuestionTiming[] = [];
  private windowEvents: WindowEvent[] = [];
  /** Wall-clock start of the current away spell; null while in the test window. */
  private awaySince: number | null = null;
  private awayKind: WindowEvent["kind"] = "window";
  /** Set around our own window.confirm() — the dialog takes focus, the candidate never left. */
  private suppressAway = false;

  constructor(private readonly startedAt: number) {}

  private now() {
    return Date.now() - this.startedAt;
  }

  private get current(): QuestionTiming | null {
    return this.questions[this.questions.length - 1] ?? null;
  }

  startQuestion(opts: { rung: CefrRung; warmup?: boolean; reask?: boolean }) {
    this.questions.push({
      index: this.questions.length,
      questionId: null,
      rung: opts.rung,
      askedEndMs: null,
      latencyMs: null,
      answerMs: null,
      awayMs: 0,
      warmup: opts.warmup || undefined,
      reask: opts.reask || undefined,
    });
  }

  /** The avatar stopped speaking the open question. Ignored once an answer started (e.g. the closing remark). */
  questionAsked(questionId: string | null) {
    const q = this.current;
    if (!q || q.latencyMs !== null) return;
    q.askedEndMs = this.now();
    q.questionId ??= questionId;
  }

  /** First confirmed answer segment of the open question; later segments don't move it. */
  answerStarted(startedAtWallMs: number, spokenMs: number) {
    const q = this.current;
    if (!q || q.latencyMs !== null) return;
    const startMs = startedAtWallMs - this.startedAt;
    // Speech that began before the question ended: a barge-in, or an answer
    // spoken over the avatar and buffered — either way, no silence at all.
    if (q.askedEndMs === null || startMs < q.askedEndMs) {
      q.latencyMs = 0;
      q.bargeIn = true;
    } else {
      q.latencyMs = startMs - q.askedEndMs;
    }
    q.answerMs = Math.round(spokenMs);
  }

  mark(flag: QuestionFlag) {
    const q = this.current;
    if (q) q[flag] = true;
  }

  /** Runs `fn` (a blocking confirm dialog) without counting the focus it takes as leaving the window. */
  withoutAway<T>(fn: () => T): T {
    this.suppressAway = true;
    try {
      return fn();
    } finally {
      // The dialog's blur can be dispatched just after it closes.
      setTimeout(() => { this.suppressAway = false; }, 100);
    }
  }

  /** Tab hidden ("tab") or window blurred ("window"). A hide during a blur upgrades the spell to "tab". */
  leave(kind: WindowEvent["kind"]) {
    if (this.suppressAway) return;
    if (this.awaySince === null) {
      this.awaySince = Date.now();
      this.awayKind = kind;
    } else if (kind === "tab") {
      this.awayKind = "tab";
    }
  }

  /** Back in the test window. Returns the time away when it was long enough to record, else null. */
  back(): number | null {
    if (this.awaySince === null) return null;
    const awayMs = Date.now() - this.awaySince;
    const atMs = this.awaySince - this.startedAt;
    this.awaySince = null;
    if (awayMs < MIN_AWAY_MS) return null;
    const q = this.current;
    // Only while the question is still waiting for its answer: leaving during
    // the candidate's own answer is not "away before answering".
    if (q && q.latencyMs === null) q.awayMs += awayMs;
    this.windowEvents.push({ kind: this.awayKind, atMs, awayMs, question: q?.index ?? null });
    return awayMs;
  }

  record(): IntegrityRecord {
    return { version: 1, questions: this.questions.map((q) => ({ ...q })), windowEvents: [...this.windowEvents] };
  }
}
