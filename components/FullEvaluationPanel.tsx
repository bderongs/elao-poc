"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { SessionSummary } from "@/lib/types";
import { ThinkingIndicator } from "@/components/ThinkingIndicator";
import { RecomputeRollupButton } from "@/components/RecomputeRollupButton";
import styles from "./admin.module.css";

export interface ProviderOption {
  id: string;
  label: string;
}

interface TurnResult {
  turnId: string;
  error?: string;
}

/**
 * One provider's row: a checkbox (selectable, default), a "running" badge
 * (a launch is in flight — not selectable, nothing to configure mid-run), or
 * a "scored" badge (already has a result for this session — not selectable,
 * avoids an accidental re-billed re-run). Pending always wins over
 * already-scored — the two are mutually exclusive by construction (see
 * pronunciationProviderPending/isEvalProviderPending), but pending is the
 * more useful thing to show if both were ever true.
 */
function ProviderRow({
  provider,
  checked,
  pending,
  alreadyScored,
  onToggle,
}: {
  provider: ProviderOption;
  checked: boolean;
  pending: boolean;
  alreadyScored: boolean;
  onToggle: () => void;
}) {
  if (pending) {
    return (
      <span className={styles.pendingBadge} title="Launched — waiting for the result">
        <ThinkingIndicator variant="inline" />
        {provider.label}
      </span>
    );
  }
  if (alreadyScored) {
    return (
      <span className={styles.scoredBadge} title="Already has a result for this session — re-running replaces it with a fresh (paid) call">
        <span className={styles.scoredCheck}>✓</span>
        {provider.label}
      </span>
    );
  }
  return (
    <label className={styles.checkboxLabel}>
      <input type="checkbox" checked={checked} onChange={onToggle} />
      {provider.label}
    </label>
  );
}

/**
 * Runs the whole session through the pronunciation lab (every recorded turn)
 * and/or the eval lab (the full transcript) in one action, via
 * POST /api/sessions/:id/assess-all — the batch sibling of the per-turn
 * PronunciationLabPanel and per-session EvalLabPanel, for when you want a
 * comparable global score without clicking through every turn.
 */
export function FullEvaluationPanel({
  sessionId,
  sessionSource,
  pronunciationProviders,
  evalProviders,
  alreadyScoredPronunciationIds,
  alreadyScoredEvalIds,
  pendingPronunciationIds,
  pendingEvalIds,
}: {
  sessionId: string;
  sessionSource: SessionSummary["source"];
  pronunciationProviders: ProviderOption[];
  evalProviders: ProviderOption[];
  alreadyScoredPronunciationIds: string[];
  alreadyScoredEvalIds: string[];
  pendingPronunciationIds: string[];
  pendingEvalIds: string[];
}) {
  const router = useRouter();
  // Only providers without an existing (or in-flight) result are selected/
  // selectable by default — every run is a fresh, uncached, paid call
  // (lib/pronunciation/assess.ts), so re-checking something already scored
  // or already running should be a deliberate choice, not the default.
  const [selectedPron, setSelectedPron] = useState<Set<string>>(
    new Set(
      pronunciationProviders
        .filter((p) => !alreadyScoredPronunciationIds.includes(p.id) && !pendingPronunciationIds.includes(p.id))
        .map((p) => p.id)
    )
  );
  const [selectedEval, setSelectedEval] = useState<Set<string>>(
    new Set(evalProviders.filter((p) => !alreadyScoredEvalIds.includes(p.id) && !pendingEvalIds.includes(p.id)).map((p) => p.id))
  );
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  const anyPending = pendingPronunciationIds.length > 0 || pendingEvalIds.length > 0;
  // A stable string, not the arrays themselves, so the effect only resets
  // its interval when the actual SET of pending providers changes — not on
  // every unrelated re-render (the arrays are fresh references each time).
  const pendingKey = [...pendingPronunciationIds, ...pendingEvalIds].sort().join(",");

  // While anything is pending — including right after a page load that finds
  // an in-flight run from before a refresh — poll for the result instead of
  // requiring a manual refresh. Stops itself once nothing is pending anymore.
  useEffect(() => {
    if (!pendingKey) return;
    const interval = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(interval);
  }, [pendingKey, router]);

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  };

  const run = async () => {
    if (!selectedPron.size && !selectedEval.size) return;
    setRunning(true);
    setError(null);
    setSummary(null);
    // Don't await the fetch before refreshing — the server writes pending
    // placeholder rows almost immediately (see assessTurn/runCefrEvaluation),
    // so a refresh shortly after launching already picks up "running" badges
    // instead of waiting for the whole (possibly slow) batch to finish. The
    // polling effect above then keeps refreshing until nothing is pending.
    const fetchPromise = fetch(`/api/sessions/${sessionId}/assess-all`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pronunciationProviders: Array.from(selectedPron),
        evalProviders: Array.from(selectedEval),
      }),
    });
    setTimeout(() => router.refresh(), 1200);
    try {
      const res = await fetchPromise;
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      const failed = ((data.turnResults ?? []) as TurnResult[]).filter((r) => r.error).length;
      const parts: string[] = [];
      if (selectedPron.size) parts.push(`assessed ${data.turnsAssessed ?? 0} turn(s)${failed ? ` (${failed} failed)` : ""}`);
      if (selectedEval.size) parts.push("transcript evaluated");
      setSummary(parts.join(" · "));
      router.refresh();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
      // Even on a client-side failure (e.g. the tab navigated away and back),
      // the server-side run may still be in flight or may have already
      // written results — refresh to reflect whatever actually happened.
      router.refresh();
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className={styles.card}>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Run full evaluation</div>
      <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 10 }}>
        Runs every checked provider against every recorded turn (pronunciation) and the full transcript (CEFR) —
        results appear side-by-side in Score breakdown below.
      </div>

      {sessionSource === "conversation" && (
        <div
          style={{
            fontSize: 11,
            color: "#fbbf24",
            padding: "8px 10px",
            marginBottom: 10,
            border: "1px solid rgba(251, 191, 36, 0.35)",
            borderRadius: 6,
            background: "rgba(251, 191, 36, 0.08)",
          }}
        >
          This session was recorded live — pronunciation-provider runs here are saved for comparison below but
          won&apos;t change this session&apos;s headline score (protected by design).
        </div>
      )}

      <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 6 }}>Pronunciation (every recorded turn)</div>
      <div className={styles.evalLabControls} style={{ marginBottom: 10 }}>
        {pronunciationProviders.map((p) => (
          <ProviderRow
            key={p.id}
            provider={p}
            checked={selectedPron.has(p.id)}
            pending={pendingPronunciationIds.includes(p.id)}
            alreadyScored={alreadyScoredPronunciationIds.includes(p.id)}
            onToggle={() => toggle(selectedPron, setSelectedPron, p.id)}
          />
        ))}
      </div>

      <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 6 }}>Transcript (CEFR eval)</div>
      <div className={styles.evalLabControls} style={{ marginBottom: 12 }}>
        {evalProviders.map((p) => (
          <ProviderRow
            key={p.id}
            provider={p}
            checked={selectedEval.has(p.id)}
            pending={pendingEvalIds.includes(p.id)}
            alreadyScored={alreadyScoredEvalIds.includes(p.id)}
            onToggle={() => toggle(selectedEval, setSelectedEval, p.id)}
          />
        ))}
      </div>

      <button onClick={run} disabled={running || (!selectedPron.size && !selectedEval.size)} className={styles.runButton}>
        {running ? "Launching…" : "Run full evaluation"}
      </button>

      {error && <div className={styles.errorBox} style={{ marginTop: 8 }}>{error}</div>}
      {summary && !error && <div style={{ marginTop: 8, fontSize: 12, color: "#4ade80" }}>{summary}</div>}
      {anyPending && !summary && !error && (
        <div style={{ marginTop: 8, fontSize: 12, color: "#9ca3af", display: "flex", alignItems: "center", gap: 6 }}>
          <ThinkingIndicator variant="inline" />
          Launched — waiting for result, this refreshes automatically.
        </div>
      )}

      {(sessionSource === "upload" || sessionSource === "speechace") && (
        <RecomputeRollupButton sessionId={sessionId} />
      )}
    </div>
  );
}
