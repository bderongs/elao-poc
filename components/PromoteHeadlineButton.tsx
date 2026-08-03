"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Overwrites a live-conversation session's headline azure_scores with its
 * latest azure-ensemble pronunciation-lab re-run — POST
 * /api/sessions/:id/promote-rollup. Deliberately bypasses the normal
 * protection that keeps a conversation session's headline score as the live
 * flow's original output (see promoteConversationRollup in
 * lib/sessions-service.ts); confirmed inline since it overwrites the number
 * shown everywhere for this session with no way back short of re-running the
 * live conversation itself.
 */
export function PromoteHeadlineButton({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const run = async () => {
    if (
      !window.confirm(
        "Overwrite this session's headline score with the latest azure-ensemble pronunciation-lab result? This replaces the number shown everywhere for this session and can't be undone (short of re-running the live conversation).",
      )
    ) {
      return;
    }
    setRunning(true);
    setError(null);
    setDone(false);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/promote-rollup`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setDone(true);
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
          color: "#fbbf24",
          textDecoration: "underline",
          cursor: running ? "default" : "pointer",
        }}
      >
        {running ? "Promoting…" : "Promote azure-ensemble result to headline score"}
      </button>
      {error && <div style={{ marginTop: 6, fontSize: 11, color: "#f87171" }}>{error}</div>}
      {done && !error && <div style={{ marginTop: 6, fontSize: 11, color: "#4ade80" }}>Headline score updated.</div>}
    </div>
  );
}
