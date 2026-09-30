import type { LadderRecord } from "@/lib/session-length";
import styles from "./admin.module.css";

// Admin view of a live session's difficulty ladder (sessions.ladder_json,
// lib/session-length.ts): one row per pacing-judge (ET) result, plus where
// the adaptive stop rule would have ended — or did end — the session. The
// data "shadow" mode exists to collect, for calibrating that rule.

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

const REASON_LABELS: Record<string, string> = {
  bracketed: "level bracketed between two rungs",
  plateau: "held at the same rung",
  ceiling: "consistently well at C2",
  floor: "consistently struggling at A1",
  max_reached: "hit the maximum without settling",
  not_converged: "level still moving",
  too_few_answers: "too few answers",
  no_long_answer: "no long answer at that level",
};

export function LadderPanel({ ladder, durationSeconds, finalLevel }: { ladder: LadderRecord; durationSeconds: number | null; finalLevel: string | null }) {
  const verdictLine =
    ladder.wouldStopAt != null
      ? `Would stop at ${mmss(ladder.wouldStopAt)} · ${ladder.estimatedLevel ?? "?"} (${REASON_LABELS[ladder.reason ?? ""] ?? ladder.reason})`
      : `Would continue past ${durationSeconds != null ? mmss(durationSeconds) : "the end"} — ${REASON_LABELS[ladder.reason ?? ""] ?? "not settled"}${ladder.estimatedLevel ? ` (leaning ${ladder.estimatedLevel})` : ""}`;

  return (
    <div>
      <div className={styles.detailMeta}>
        Mode: {ladder.mode} · bounds {mmss(ladder.minSeconds)}–{mmss(ladder.maxSeconds)} · actual {durationSeconds != null ? mmss(durationSeconds) : "?"} · final level {finalLevel ?? "—"}
      </div>
      <div className={styles.detailMeta} style={{ fontWeight: 600 }}>{verdictLine}</div>
      {ladder.steps.length ? (
        <div className={styles.tableCard}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>#</th>
                <th>At</th>
                <th>Rung</th>
                <th>Verdict</th>
                <th>Next</th>
                <th>Words</th>
              </tr>
            </thead>
            <tbody>
              {ladder.steps.map((s, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td>{mmss(s.atSeconds)}</td>
                  <td>{s.rung}</td>
                  <td>{s.verdict}</td>
                  <td>{s.nextRung}</td>
                  <td>{s.words}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={styles.emptyState}>No pacing-judge results recorded.</div>
      )}
    </div>
  );
}
