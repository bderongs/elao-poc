"use client";

import { useState } from "react";
import { FullEvaluationPanel, type ProviderOption } from "@/components/FullEvaluationPanel";
import type { SessionSummary } from "@/lib/types";
import styles from "@/components/admin.module.css";

/**
 * The batch "run full evaluation" controls, tucked behind a gear icon inside
 * the score breakdown panel instead of sitting as their own always-visible
 * block — it's a configuration action for the comparison data, not part of
 * reading it.
 */
export function RunEvaluationGear({
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
  const [open, setOpen] = useState(false);
  const anyPending = pendingPronunciationIds.length > 0 || pendingEvalIds.length > 0;

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={styles.gearButton}
        title={anyPending ? "A run is in progress for this session" : "Run pronunciation/CEFR comparisons for this session"}
        aria-label="Run pronunciation/CEFR comparisons for this session"
        style={{ position: "relative" }}
      >
        ⚙
        {anyPending && (
          <span
            aria-hidden
            style={{
              position: "absolute",
              top: -2,
              right: -2,
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "#fbbf24",
              boxShadow: "0 0 0 2px #0f172a",
            }}
          />
        )}
      </button>
      {open && (
        <div className={styles.gearPopover}>
          <FullEvaluationPanel
            sessionId={sessionId}
            sessionSource={sessionSource}
            pronunciationProviders={pronunciationProviders}
            evalProviders={evalProviders}
            alreadyScoredPronunciationIds={alreadyScoredPronunciationIds}
            alreadyScoredEvalIds={alreadyScoredEvalIds}
            pendingPronunciationIds={pendingPronunciationIds}
            pendingEvalIds={pendingEvalIds}
          />
        </div>
      )}
    </div>
  );
}
