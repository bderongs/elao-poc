import {
  isCountedQuestion,
  isLongSilence,
  levelBand,
  summarizeIntegrity,
  type IntegrityLevel,
  type IntegrityRecord,
  type IntegritySettings,
  type QuestionTiming,
} from "@/lib/integrity";
import { adminColors } from "@/lib/admin-theme";
import styles from "./admin.module.css";

// Admin view of sessions.integrity_json (lib/integrity.ts): the none / low /
// high hint with its reasons, then the raw facts it was computed from — one
// row per question, one per spell outside the test window. A hint for the
// reviewer, never a verdict: the score is never changed by any of this.

const LEVEL_STYLE: Record<IntegrityLevel, { label: string; bg: string; ink: string }> = {
  none: { label: "No signal", bg: adminColors.panel, ink: adminColors.muted },
  low: { label: "Low", bg: adminColors.warningBg, ink: adminColors.warning },
  high: { label: "High", bg: adminColors.dangerBg, ink: adminColors.danger },
};

const sec = (ms: number | null) => (ms == null ? "—" : `${(ms / 1000).toFixed(1)} s`);
const mmss = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function notes(q: QuestionTiming): string {
  return [
    q.warmup && "warm-up",
    q.reask && "re-ask",
    q.clarify && "« je ne comprends pas »",
    q.repeat && "repeated",
    q.skipped && "skipped",
    q.bargeIn && "spoke over the avatar",
    q.techIssue && "technical issue",
    q.latencyMs === null && !q.skipped && !q.clarify && "no answer heard",
  ]
    .filter(Boolean)
    .join(", ");
}

/** Small badge for the session header — renders nothing at "none". */
export function IntegrityBadge({ record, settings }: { record: IntegrityRecord; settings: IntegritySettings }) {
  const { level } = summarizeIntegrity(record, settings);
  if (level === "none") return null;
  const s = LEVEL_STYLE[level];
  return (
    <span className={styles.badge} style={{ background: s.bg, color: s.ink }} title="Integrity signal — a hint, not a verdict">
      Integrity: {s.label}
    </span>
  );
}

export function IntegrityPanel({ record, settings }: { record: IntegrityRecord; settings: IntegritySettings }) {
  const summary = summarizeIntegrity(record, settings);
  const s = LEVEL_STYLE[summary.level];
  const t = settings.silenceThresholdSec;

  return (
    <div>
      <div className={styles.detailMeta} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span className={styles.badge} style={{ background: s.bg, color: s.ink }}>{s.label}</span>
        <span>
          {summary.reasons.length ? summary.reasons.join(" · ") : "Nothing above the thresholds."} The score is never changed by this.
        </span>
      </div>
      <div className={styles.detailMeta}>
        {summary.longSilences} long silence{summary.longSilences === 1 ? "" : "s"} on {summary.countedQuestions} counted question
        {summary.countedQuestions === 1 ? "" : "s"} · {summary.skipped} skipped · {summary.windowChanges} window change
        {summary.windowChanges === 1 ? "" : "s"}, {summary.awaySec} s away · thresholds A {t.A} s / B {t.B} s / C {t.C} s, signal from{" "}
        {settings.minLongSilences} long silences or {settings.minWindowChanges} window changes / {settings.minAwaySec} s away (/admin/settings)
      </div>

      {record.questions.length > 0 && (
        <div className={styles.tableCard}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>#</th>
                <th>Rung</th>
                <th>Asked at</th>
                <th>Silence before answer</th>
                <th>Answer</th>
                <th>Away</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {record.questions.map((q) => {
                const long = isLongSilence(q, settings);
                return (
                  <tr key={q.index}>
                    <td data-label="#">{q.index + 1}</td>
                    <td data-label="Rung">{q.rung}</td>
                    <td data-label="Asked at">{q.askedEndMs == null ? "—" : mmss(q.askedEndMs)}</td>
                    <td
                      data-label="Silence before answer"
                      style={{ fontWeight: long ? 600 : undefined, color: long ? adminColors.danger : isCountedQuestion(q) ? undefined : adminColors.faint }}
                      title={long ? `Over the ${levelBand(q.rung)} threshold (${t[levelBand(q.rung)]} s)` : undefined}
                    >
                      {sec(q.latencyMs)}
                    </td>
                    <td data-label="Answer">{sec(q.answerMs)}</td>
                    <td data-label="Away">{q.awayMs ? sec(q.awayMs) : "—"}</td>
                    <td data-label="Notes" style={{ color: adminColors.muted }}>{notes(q)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {record.windowEvents.length > 0 && (
        <div className={styles.tableCard} style={{ marginTop: 12 }}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Left at</th>
                <th>Away</th>
                <th>How</th>
                <th>During question</th>
              </tr>
            </thead>
            <tbody>
              {record.windowEvents.map((e, i) => (
                <tr key={i}>
                  <td data-label="Left at">{mmss(e.atMs)}</td>
                  <td data-label="Away">{sec(e.awayMs)}</td>
                  <td data-label="How">{e.kind === "tab" ? "tab hidden / minimised" : "other window focused"}</td>
                  <td data-label="During question">{e.question == null ? "—" : e.question + 1}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
