"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { TurnEvaluationRow } from "@/lib/types";
import { UserWords } from "@/components/ScoreDisplay";
import { formatDateTime, formatTime } from "@/lib/format-date";
import styles from "./admin.module.css";

export interface PronunciationProviderOption {
  id: string;
  label: string;
}

export function PronunciationLabPanel({
  sessionId,
  turnId,
  providers,
  initialEvaluations,
}: {
  sessionId: string;
  turnId: string;
  providers: PronunciationProviderOption[];
  initialEvaluations: TurnEvaluationRow[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set(providers.map((p) => p.id)));
  const [evaluations, setEvaluations] = useState<TurnEvaluationRow[]>(initialEvaluations);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  // Latest run overall for this turn (any provider) — what the session-level
  // rollup uses for its "global" score on uploaded sessions.
  const latestId = useMemo(() => {
    if (!evaluations.length) return null;
    return evaluations.reduce((latest, e) =>
      new Date(e.created_at) > new Date(latest.created_at) ? e : latest
    ).id;
  }, [evaluations]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const run = async () => {
    if (!selected.size) return;
    setRunning(true);
    setRunError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/turns/${turnId}/assess`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providers: Array.from(selected) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setEvaluations((prev) => [...(data.results ?? []), ...prev]);
      // Picks up the recomputed turn transcript / session azure_scores
      // (uploaded sessions only — see recomputeSessionRollup).
      router.refresh();
    } catch (e) {
      setRunError(String(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className={styles.evalLab} style={{ marginTop: 12, borderTop: "none", paddingTop: 0 }}>
      <div className={styles.evalLabControls}>
        {providers.map((p) => (
          <label key={p.id} className={styles.checkboxLabel}>
            <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
            {p.label}
          </label>
        ))}
        <button onClick={run} disabled={running || !selected.size} className={styles.runButton}>
          {running ? "Running…" : "Run pronunciation lab"}
        </button>
      </div>

      {runError && <div className={styles.errorBox} style={{ marginTop: 8 }}>{runError}</div>}

      {evaluations.length > 0 && (
        <div className={styles.evalTableWrap} style={{ marginTop: 8 }}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Provider</th>
                <th>Score</th>
                <th>WPM</th>
                <th>Words</th>
                <th>ms</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {evaluations.map((e) => (
                <tr key={e.id}>
                  <td data-label="Provider" style={{ fontWeight: 600 }}>
                    {e.provider_id}
                    {e.id === latestId && (
                      <span
                        title="Most recent run for this recording — feeds the session's global score"
                        style={{
                          marginLeft: 6,
                          background: "#4ade80",
                          color: "#000",
                          borderRadius: 3,
                          padding: "1px 5px",
                          fontSize: 10,
                          fontWeight: 700,
                          cursor: "help",
                        }}
                      >
                        latest
                      </span>
                    )}
                  </td>
                  {e.error ? (
                    <td data-label="Error" colSpan={3} style={{ color: "#f87171" }}>
                      {e.error}
                    </td>
                  ) : !e.result_json ? (
                    <td data-label="Status" colSpan={3} style={{ color: "#fbbf24" }}>
                      Running…
                    </td>
                  ) : (
                    <>
                      <td data-label="Score">{e.result_json?.pronunciationScore ?? "—"}</td>
                      <td data-label="WPM">{e.result_json?.wpm ?? "—"}</td>
                      <td data-label="Words">
                        {e.result_json?.words?.length ? <UserWords words={e.result_json.words} /> : "—"}
                      </td>
                    </>
                  )}
                  <td data-label="ms">{e.duration_ms ?? "—"}</td>
                  <td data-label="When" style={{ color: "#6b7280" }} title={formatDateTime(e.created_at)}>
                    {formatTime(e.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
