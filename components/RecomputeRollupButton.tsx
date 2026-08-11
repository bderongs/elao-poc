"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-derives an uploaded session's transcript + pronunciation_scores from
 * whatever pronunciation-lab evaluations already exist — POST /api/sessions/:id/recompute.
 * Needed for sessions assessed before the auto-recompute-after-assess wiring
 * existed, or to pull in a manual override once that lands. Tucked into the
 * run-evaluation gear as a small link since it's a rare maintenance action,
 * not a primary control.
 */
export function RecomputeRollupButton({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/recompute`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      router.refresh();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div style={{ marginTop: 10 }}>
      <button
        onClick={run}
        disabled={running}
        style={{
          background: "none",
          border: "none",
          padding: 0,
          fontSize: 11,
          color: "#9ca3af",
          textDecoration: "underline",
          cursor: running ? "default" : "pointer",
        }}
      >
        {running ? "Recomputing…" : "Recompute global score"}
      </button>
      {error && <div style={{ marginTop: 6, fontSize: 11, color: "#f87171" }}>{error}</div>}
    </div>
  );
}
