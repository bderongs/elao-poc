"use client";

import { CefrPanel } from "@/components/ScoreDisplay";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { ClaimResultsForm } from "@/components/ClaimResultsForm";
import { CandidateTopBar } from "@/components/CandidateTopBar";
import styles from "@/components/candidate.module.css";
import type { CefrResult, PronunciationAvg } from "@/lib/types";

const FR_CEFR_LABELS = {
  eyebrow: "VOTRE NIVEAU",
  score: "Score",
  strengths: "Points forts",
  toImprove: "À travailler",
  notableErrors: "Erreurs notables",
  confidence: { high: "FIABLE", medium: "MOYEN", low: "INDICATIF" },
};

/**
 * The "done" phase screen (doc/new_design's visual language, extended past
 * screen 4 — the handoff itself stops at "analyse en cours"). Leads with a
 * thank-you, keeps the score card as the centerpiece, offers the account
 * sign-up right under it, and tucks the recording/transcript behind a
 * collapsed section most users won't open.
 */
export function SessionResultsScreen({
  cefrResult,
  pronunciationAvg,
  evalFailed,
  audioBlobUrl,
  transcriptPanel,
  sessionId,
  onRestart,
}: {
  cefrResult: CefrResult | null;
  pronunciationAvg: PronunciationAvg | null;
  evalFailed: boolean;
  audioBlobUrl: string | null;
  transcriptPanel: React.ReactNode;
  sessionId: string | null;
  onRestart: () => void;
}) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "auto", background: "#F7F5F0" }}>
      <CandidateTopBar
        right={
          <span
            onClick={onRestart}
            className={styles.tapTarget}
            style={{ fontSize: 14, color: "#6B6F7D", borderBottom: "1px solid #C9C4B8", paddingBottom: 2, cursor: "pointer" }}
          >
            Nouvelle session
          </span>
        }
      />

      <div className={styles.resultsBody}>
        {/* Hero */}
        <div style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: 8, marginBottom: 4 }}>
          <h2 className={styles.titleM} style={{ margin: 0, fontFamily: "'Outfit',sans-serif", fontWeight: 400, color: "#141D33", letterSpacing: "-0.02em" }}>
            Merci d&apos;avoir passé le test.
          </h2>
          <p style={{ margin: 0, fontSize: 16, color: "#5A5F6E" }}>Voici votre résultat.</p>
        </div>

        {cefrResult && (
          <CefrPanel result={cefrResult} pronunciationAvg={pronunciationAvg} labels={FR_CEFR_LABELS} theme="light" />
        )}

        {evalFailed && !cefrResult && (
          <div
            style={{
              padding: 16,
              borderRadius: 12,
              background: "#FDF0D0",
              border: "1px solid #F0DDA8",
              color: "#8A6410",
              fontSize: 14,
            }}
          >
            L&apos;évaluation n&apos;a pas pu être finalisée, mais votre session a bien été enregistrée.
          </div>
        )}

        {sessionId && <ClaimResultsForm sessionId={sessionId} light />}

        <CollapsibleSection title="Voir le détail : enregistrement et transcription" defaultOpen={false} light>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 12 }}>
            {audioBlobUrl && (
              <div style={{ padding: "16px 18px", borderRadius: 14, background: "#FFFFFF", border: "1px solid #E4E0D7" }}>
                <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: "#8A8F9C", letterSpacing: "0.1em", marginBottom: 10 }}>
                  ÉCOUTER
                </div>
                <audio controls src={audioBlobUrl} style={{ width: "100%", height: 32, accentColor: "#141D33" }} />
                <div style={{ fontSize: 12, color: "#8A8F9C", marginTop: 8 }}>
                  Les mots colorés dans la transcription ci-dessous indiquent la qualité de prononciation.
                </div>
              </div>
            )}
            <div style={{ border: "1px solid #E4E0D7", borderRadius: 14, overflow: "hidden", maxHeight: "min(480px, 60dvh)", display: "flex", flexDirection: "column", background: "#FFFFFF" }}>
              {transcriptPanel}
            </div>
          </div>
        </CollapsibleSection>
      </div>
    </div>
  );
}
