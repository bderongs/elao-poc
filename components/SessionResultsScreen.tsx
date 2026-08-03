"use client";

import { CefrPanel } from "@/components/ScoreDisplay";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { ClaimResultsForm } from "@/components/ClaimResultsForm";
import type { CefrResult, AzureAvg } from "@/lib/types";

const FR_CEFR_LABELS = {
  eyebrow: "TON NIVEAU",
  score: "Score",
  strengths: "Points forts",
  toImprove: "À travailler",
  notableErrors: "Erreurs notables",
  confidence: { high: "FIABLE", medium: "MOYEN", low: "INDICATIF" },
};

/**
 * The "done" phase screen — replaces the old bare CefrPanel + audio + full
 * transcript dump. Leads with a thank-you, keeps the score card as the
 * centerpiece, offers the account sign-up right under it, and tucks the
 * recording/transcript behind a collapsed section most users won't open.
 */
export function SessionResultsScreen({
  cefrResult,
  azureAvg,
  evalFailed,
  audioBlobUrl,
  transcriptPanel,
  sessionId,
}: {
  cefrResult: CefrResult | null;
  azureAvg: AzureAvg | null;
  evalFailed: boolean;
  audioBlobUrl: string | null;
  transcriptPanel: React.ReactNode;
  sessionId: string | null;
}) {
  return (
    <div style={{ flex: 1, overflow: "auto" }}>
      <div style={{ maxWidth: 560, margin: "0 auto", padding: "32px 16px 48px", display: "flex", flexDirection: "column", gap: 20 }}>
        {/* Hero */}
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              background: "rgba(74, 222, 128, 0.15)",
              color: "#4ade80",
              fontSize: 28,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 14px",
            }}
          >
            ✓
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#f1f5f9" }}>Merci d&apos;avoir passé le test !</div>
          <div style={{ fontSize: 14, color: "#94a3b8", marginTop: 4 }}>Voici ton résultat.</div>
        </div>

        {cefrResult && (
          <div style={{ boxShadow: "0 8px 30px rgba(0,0,0,0.35)", borderRadius: 12, overflow: "hidden" }}>
            <CefrPanel result={cefrResult} azureAvg={azureAvg} labels={FR_CEFR_LABELS} />
          </div>
        )}

        {evalFailed && !cefrResult && (
          <div
            style={{
              padding: 16,
              borderRadius: 8,
              background: "#3f1d1d",
              border: "1px solid #7f1d1d",
              color: "#fecaca",
              fontSize: 13,
            }}
          >
            L&apos;évaluation n&apos;a pas pu être finalisée, mais ta session a bien été enregistrée.
          </div>
        )}

        {sessionId && <ClaimResultsForm sessionId={sessionId} />}

        <CollapsibleSection title="Voir le détail : enregistrement et transcription" defaultOpen={false}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 12 }}>
            {audioBlobUrl && (
              <div style={{ padding: "10px 12px", borderRadius: 8, background: "#0f172a", border: "1px solid #1e293b" }}>
                <div style={{ fontSize: 10, color: "#60a5fa", fontWeight: 700, letterSpacing: 1, marginBottom: 6 }}>
                  ÉCOUTER
                </div>
                <audio controls src={audioBlobUrl} style={{ width: "100%", height: 32, accentColor: "#4f46e5" }} />
                <div style={{ fontSize: 10, color: "#475569", marginTop: 4 }}>
                  Les mots colorés dans la transcription ci-dessous indiquent la qualité de prononciation.
                </div>
              </div>
            )}
            <div style={{ border: "1px solid #1e293b", borderRadius: 8, overflow: "hidden", maxHeight: 480, display: "flex", flexDirection: "column" }}>
              {transcriptPanel}
            </div>
          </div>
        </CollapsibleSection>
      </div>
    </div>
  );
}
