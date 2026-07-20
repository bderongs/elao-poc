"use client";

import { useState } from "react";
import type { CefrResult } from "./ScoreDisplay";

export interface ProviderOption {
  id: string;
  label: string;
}

export interface EvaluationRow {
  id: string;
  model_id: string;
  prompt_version: string;
  result_json: CefrResult | null;
  error: string | null;
  duration_ms: number | null;
  created_at: string;
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
    <div style={{ marginTop: 20, borderTop: "1px solid #1e293b", paddingTop: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Eval lab — replay this transcript</div>

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
        {providers.map((p) => (
          <label key={p.id} style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
            <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
            {p.label}
          </label>
        ))}
        <button
          onClick={run}
          disabled={running || !selected.size}
          style={{
            padding: "4px 12px",
            borderRadius: 4,
            border: "none",
            background: running ? "#334155" : "#4f46e5",
            color: "#fff",
            fontSize: 12,
            fontWeight: 600,
            cursor: running ? "default" : "pointer",
          }}
        >
          {running ? "Running…" : "Run"}
        </button>
      </div>

      {runError && <div style={{ color: "#f87171", fontSize: 12, marginBottom: 8 }}>{runError}</div>}

      {evaluations.length === 0 ? (
        <div style={{ fontSize: 12, color: "#9ca3af" }}>No replay evaluations yet — pick model(s) and run.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "#9ca3af", borderBottom: "1px solid #334155" }}>
                <th style={{ padding: "4px 6px" }}>Model</th>
                <th style={{ padding: "4px 6px" }}>Prompt</th>
                <th style={{ padding: "4px 6px" }}>Level</th>
                <th style={{ padding: "4px 6px" }}>Score</th>
                <th style={{ padding: "4px 6px" }}>Fluency</th>
                <th style={{ padding: "4px 6px" }}>Vocab/Gram</th>
                <th style={{ padding: "4px 6px" }}>Comm.</th>
                <th style={{ padding: "4px 6px" }}>Confidence</th>
                <th style={{ padding: "4px 6px" }}>ms</th>
                <th style={{ padding: "4px 6px" }}>When</th>
              </tr>
            </thead>
            <tbody>
              {evaluations.map((e) => (
                <tr key={e.id} style={{ borderBottom: "1px solid #1e293b" }}>
                  <td style={{ padding: "4px 6px", fontWeight: 600 }}>{e.model_id}</td>
                  <td style={{ padding: "4px 6px" }}>{e.prompt_version}</td>
                  {e.error ? (
                    <td colSpan={6} style={{ padding: "4px 6px", color: "#f87171" }}>
                      {e.error}
                    </td>
                  ) : (
                    <>
                      <td style={{ padding: "4px 6px" }}>{e.result_json?.level ?? "—"}</td>
                      <td style={{ padding: "4px 6px" }}>{e.result_json?.score_percent ?? "—"}</td>
                      <td style={{ padding: "4px 6px" }}>{e.result_json?.dimensions.fluency ?? "—"}</td>
                      <td style={{ padding: "4px 6px" }}>{e.result_json?.dimensions.vocabulary_grammar ?? "—"}</td>
                      <td style={{ padding: "4px 6px" }}>{e.result_json?.dimensions.communication ?? "—"}</td>
                      <td style={{ padding: "4px 6px" }}>{e.result_json?.confidence ?? "—"}</td>
                    </>
                  )}
                  <td style={{ padding: "4px 6px" }}>{e.duration_ms ?? "—"}</td>
                  <td style={{ padding: "4px 6px", color: "#6b7280" }}>{new Date(e.created_at).toLocaleTimeString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
