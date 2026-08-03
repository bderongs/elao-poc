import { wordColor } from "@/components/ScoreDisplay";

export interface ComparisonRow {
  id: string;
  label: string;
  score: number | null;
}

export interface ComparisonMetric {
  key: string;
  label: string;
  rows: ComparisonRow[];
  /** Omit both to render rows with no ranking (registry order, no Δ, no "closest" tag). */
  referenceLabel?: string;
  referenceScore?: number | null;
  /** Muted note rendered under the metric's header — e.g. a calibration caveat. */
  caveat?: string;
  /** Row id to tag "● current" — whichever source is actually driving the headline score above. */
  currentId?: string | null;
}

/**
 * Generic "compare providers on one metric" table. With a reference score,
 * rows are sorted closest-to-reference first and get a Δ column + a
 * "✓ closest" tag (the pattern this was extracted from, built for Speechace
 * comparisons). Without one, rows stay in the order given — sorting by raw
 * score with no common anchor would visually imply one provider "won" even
 * when the two aren't on a shared scale (see the pronunciation methods
 * caveat in /admin/scoring).
 */
export function ComparisonTable({ metrics }: { metrics: ComparisonMetric[] }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
      <thead>
        <tr style={{ color: "#9ca3af", textAlign: "left" }}>
          <th style={{ fontWeight: 500, paddingBottom: 4 }}>Source</th>
          <th style={{ fontWeight: 500, paddingBottom: 4, textAlign: "right" }}>Score</th>
          <th style={{ fontWeight: 500, paddingBottom: 4, textAlign: "right" }}>Δ</th>
        </tr>
      </thead>
      <tbody>
        {metrics.map(({ key, ...m }) => (
          <MetricSection key={key} {...m} />
        ))}
      </tbody>
    </table>
  );
}

export function ScorePill({ value }: { value: number }) {
  return (
    <span style={{ background: wordColor(value), color: "#000", borderRadius: 3, padding: "1px 6px", fontWeight: 700 }}>
      {Math.round(value * 10) / 10}
    </span>
  );
}

/** Green = within 5 points, amber = within 15, red = further off. */
function diffColor(diff: number): string {
  if (diff <= 5) return "#4ade80";
  if (diff <= 15) return "#facc15";
  return "#f87171";
}

function MetricSection({ label, rows, referenceLabel, referenceScore, caveat, currentId }: ComparisonMetric) {
  const hasReference = referenceLabel != null && referenceScore != null;
  const withDiff = rows.map((r) => ({
    ...r,
    diff: r.score != null && hasReference ? Math.abs(r.score - referenceScore!) : null,
  }));
  // Closest first when there's a reference to sort against; otherwise keep
  // the given (registry) order — providers that haven't run yet still sink
  // to the bottom either way.
  const sorted = hasReference
    ? [...withDiff].sort((a, b) => {
        if (a.diff == null && b.diff == null) return 0;
        if (a.diff == null) return 1;
        if (b.diff == null) return -1;
        return a.diff - b.diff;
      })
    : [...withDiff].sort((a, b) => (a.score == null ? 1 : 0) - (b.score == null ? 1 : 0));
  const closestId = hasReference ? sorted.find((r) => r.diff != null)?.id ?? null : null;

  return (
    <>
      <tr>
        <td colSpan={3} style={{ paddingTop: 14, paddingBottom: caveat ? 2 : 4, fontSize: 11, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.5 }}>
          {label}
        </td>
      </tr>
      {caveat && (
        <tr>
          <td colSpan={3} style={{ paddingBottom: 6, fontSize: 11, color: "#6b7280", textTransform: "none", letterSpacing: "normal", fontWeight: 400 }}>
            {caveat}
          </td>
        </tr>
      )}
      {hasReference && (
        <tr>
          <td style={{ padding: "3px 0", color: "#9ca3af" }}>{referenceLabel}</td>
          <td style={{ padding: "3px 0", textAlign: "right" }}>
            <ScorePill value={referenceScore!} />
          </td>
          <td />
        </tr>
      )}
      {sorted.map((r) => (
        <tr key={r.id} style={{ borderTop: "1px solid #334155" }}>
          <td style={{ padding: "3px 0" }}>
            {r.label}
            {r.id === currentId && (
              <span style={{ marginLeft: 6, color: "#93c5fd", fontWeight: 700, fontSize: 11 }}>● current</span>
            )}
            {r.id === closestId && (
              <span style={{ marginLeft: 6, color: "#4ade80", fontWeight: 700, fontSize: 11 }}>✓ closest</span>
            )}
          </td>
          <td style={{ padding: "3px 0", textAlign: "right" }}>
            {r.score != null ? <ScorePill value={r.score} /> : <span style={{ color: "#6b7280" }}>not yet run</span>}
          </td>
          <td style={{ padding: "3px 0", textAlign: "right", fontSize: 11, fontWeight: 600, color: r.diff != null ? diffColor(r.diff) : "#4b5563" }}>
            {r.diff != null ? `Δ${Math.round(r.diff * 10) / 10}` : "—"}
          </td>
        </tr>
      ))}
    </>
  );
}
