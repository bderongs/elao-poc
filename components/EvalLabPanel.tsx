"use client";

import { useState } from "react";
import type { EvaluationRow } from "@/lib/types";
import styles from "./admin.module.css";

export type { EvaluationRow };

export interface ProviderOption {
  id: string;
  label: string;
}

export function EvalLabPanel({
  sessionId,
  providers,
  initialEvaluations,
}: {
  sessionId: string;
  providers: ProviderOption[];
  initialEvaluations: EvaluationRow[];
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(providers.map((p) => p.id)));
  const [evaluations, setEvaluations] = useState<EvaluationRow[]>(initialEvaluations);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

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
      const res = await fetch(`/api/sessions/${sessionId}/evaluate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providers: Array.from(selected) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setEvaluations((prev) => [...(data.results ?? []), ...prev]);
    } catch (e) {
      setRunError(String(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className={styles.evalLab}>
      <div className={styles.evalLabTitle}>Eval lab — replay this transcript</div>

      <div className={styles.evalLabControls}>
        {providers.map((p) => (
          <label key={p.id} className={styles.checkboxLabel}>
            <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
            {p.label}
          </label>
        ))}
        <button onClick={run} disabled={running || !selected.size} className={styles.runButton}>
          {running ? "Running…" : "Run"}
        </button>
      </div>

      {runError && <div className={styles.errorBox} style={{ marginBottom: 10 }}>{runError}</div>}

      {evaluations.length === 0 ? (
        <div className={styles.emptyState} style={{ padding: "12px 0" }}>
          No replay evaluations yet — pick model(s) and run.
        </div>
      ) : (
        <div className={styles.evalTableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Model</th>
                <th>Prompt</th>
                <th>Level</th>
                <th>Score</th>
                <th>Fluency</th>
                <th>Vocab/Gram</th>
                <th>Comm.</th>
                <th>Confidence</th>
                <th>ms</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {evaluations.map((e) => (
                <tr key={e.id}>
                  <td data-label="Model" style={{ fontWeight: 600 }}>{e.model_id}</td>
                  <td data-label="Prompt">{e.prompt_version}</td>
                  {e.error ? (
                    <td data-label="Error" colSpan={6} style={{ color: "#f87171" }}>
                      {e.error}
                    </td>
                  ) : (
                    <>
                      <td data-label="Level">{e.result_json?.level ?? "—"}</td>
                      <td data-label="Score">{e.result_json?.score_percent ?? "—"}</td>
                      <td data-label="Fluency">{e.result_json?.dimensions.fluency ?? "—"}</td>
                      <td data-label="Vocab/Gram">{e.result_json?.dimensions.vocabulary_grammar ?? "—"}</td>
                      <td data-label="Comm.">{e.result_json?.dimensions.communication ?? "—"}</td>
                      <td data-label="Confidence">{e.result_json?.confidence ?? "—"}</td>
                    </>
                  )}
                  <td data-label="ms">{e.duration_ms ?? "—"}</td>
                  <td data-label="When" style={{ color: "#6b7280" }}>
                    {new Date(e.created_at).toLocaleTimeString()}
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
