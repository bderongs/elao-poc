"use client";

import { useState } from "react";
import { diffWords, diffSimilarity } from "@/lib/text-diff";
import styles from "./admin.module.css";

/** Green = fully reproduced, amber = mostly, red = drifted meaningfully. */
function similarityColor(pct: number): string {
  if (pct === 100) return "#4ade80";
  if (pct >= 80) return "#facc15";
  return "#f87171";
}

/**
 * Re-transcribes this turn's stored recording with today's live STT provider
 * and diffs the result word-for-word against the transcript that was
 * actually saved for it — the one leg of the assessment pipeline the
 * pronunciation/CEFR labs don't replay (they both reuse the frozen stored
 * text). See doc/assessment_process.md for why STT drift specifically needs
 * its own check right now. Ephemeral: the re-transcription and diff only
 * live in this component's state, nothing is written back.
 */
export function SttLabPanel({
  sessionId,
  turnId,
  originalText,
}: {
  sessionId: string;
  turnId: string;
  originalText: string;
}) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ text: string; wpm: number } | null>(null);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/turns/${turnId}/stt-lab`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setResult({ text: data.text, wpm: data.wpm });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const ops = result ? diffWords(originalText, result.text) : null;
  const similarityPct = ops ? Math.round(diffSimilarity(ops) * 100) : null;

  return (
    <div style={{ marginTop: 8 }}>
      <button onClick={run} disabled={running} className={styles.runButton}>
        {running ? "Re-transcribing…" : "Re-run STT"}
      </button>

      {error && (
        <div className={styles.errorBox} style={{ marginTop: 6 }}>
          {error}
        </div>
      )}

      {ops && similarityPct != null && (
        <div style={{ marginTop: 8, fontSize: 12, lineHeight: 1.7 }}>
          <div style={{ marginBottom: 4, fontWeight: 600, color: similarityColor(similarityPct) }}>
            {similarityPct}% of the stored transcript&apos;s words came back unchanged
            {result && ` · ${result.wpm} wpm this run`}
          </div>
          <div>
            {ops.map((op, idx) =>
              op.type === "same" ? (
                <span key={idx} style={{ color: "#e5e7eb" }}>
                  {op.text}{" "}
                </span>
              ) : op.type === "removed" ? (
                <span key={idx} style={{ color: "#f87171", textDecoration: "line-through" }} title="In the stored transcript, not in this re-run">
                  {op.text}{" "}
                </span>
              ) : (
                <span key={idx} style={{ color: "#4ade80", textDecoration: "underline" }} title="This re-run, not in the stored transcript">
                  {op.text}{" "}
                </span>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}
