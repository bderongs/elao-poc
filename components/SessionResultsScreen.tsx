"use client";

import { CefrPanel } from "@/components/ScoreDisplay";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { ClaimResultsForm } from "@/components/ClaimResultsForm";
import type { CefrResult, PronunciationAvg } from "@/lib/types";

const FR_CEFR_LABELS = {
  eyebrow: "VOTRE NIVEAU",
  score: "Score",
  strengths: "Points forts",
  toImprove: "À travailler",
  notableErrors: "Erreurs notables",
  confidence: { high: "FIABLE", medium: "MOYEN", low: "INDICATIF" },
};

function Logo() {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 9 }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 3 }}>
        <div style={{ width: 4, height: 10, background: "#F5B921", borderRadius: 1 }} />
        <div style={{ width: 4, height: 17, background: "#F5B921", borderRadius: 1 }} />
        <div style={{ width: 4, height: 23, background: "#F5B921", borderRadius: 1 }} />
      </div>
      <span style={{ fontFamily: "'Outfit',sans-serif", fontSize: 21, fontWeight: 500, color: "#141D33", letterSpacing: "0.02em", lineHeight: 1 }}>
        ELAO
      </span>
    </div>
  );
}

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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "22px 36px", flexShrink: 0 }}>
        <Logo />
        <span
          onClick={onRestart}
          style={{ fontSize: 14, color: "#6B6F7D", borderBottom: "1px solid #C9C4B8", paddingBottom: 2, cursor: "pointer" }}
        >
          Nouvelle session
        </span>
      </div>

      <div style={{ maxWidth: 560, width: "100%", margin: "0 auto", padding: "12px 24px 60px", display: "flex", flexDirection: "column", gap: 20 }}>
        {/* Hero */}
        <div style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: 8, marginBottom: 4 }}>
          <h2 style={{ margin: 0, fontFamily: "'Outfit',sans-serif", fontSize: 32, fontWeight: 400, color: "#141D33", letterSpacing: "-0.02em" }}>
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
            <div style={{ border: "1px solid #E4E0D7", borderRadius: 14, overflow: "hidden", maxHeight: 480, display: "flex", flexDirection: "column", background: "#FFFFFF" }}>
              {transcriptPanel}
            </div>
          </div>
        </CollapsibleSection>
      </div>
    </div>
  );
}
