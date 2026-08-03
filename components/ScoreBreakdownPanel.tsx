import { CONFIDENCE_COLOR, ExplainerCard, scoreBarColor } from "@/components/ScoreDisplay";
import { ComparisonTable, ScorePill } from "@/components/ComparisonTable";
import type { ScoreBreakdown, ScoreCategory, ConfidenceRow } from "@/lib/score-breakdown";
import type { SpeechaceScores } from "@/lib/types";
import styles from "@/components/admin.module.css";

const PRONUNCIATION_CAVEAT =
  "Azure-ensemble and Voxtral are each calibrated independently against Speechace — their raw scores aren't on a shared scale.";

function currentScoreOf(category: ScoreCategory): number | null {
  return category.rows.find((r) => r.id === category.currentId)?.score ?? null;
}

/**
 * Every category from /admin/scoring, applied to this session's actual data:
 * the value currently shown in the CefrPanel above (tagged "● current"),
 * alongside every other registered model/provider's value for the same
 * category — condensed explanation + a link to the full writeup for each.
 * Replaces the old two-metric ScoreComparisonPanel; Global and Pronunciation
 * are now two of six cards here instead of a standalone panel.
 */
export function ScoreBreakdownPanel({
  breakdown,
  speechace,
  runControls,
}: {
  breakdown: ScoreBreakdown;
  speechace: SpeechaceScores | null;
  /** RunEvaluationGear, when this session can run batch evaluations — rendered at the top-right of the panel. */
  runControls?: React.ReactNode;
}) {
  const { global, confidence, pronunciation, fluency, vocabGrammar, communication } = breakdown;
  const hasAnyScore =
    global.rows.some((r) => r.score != null) ||
    confidence.rows.some((r) => r.confidence != null) ||
    pronunciation.rows.some((r) => r.score != null) ||
    fluency.rows.some((r) => r.score != null) ||
    vocabGrammar.rows.some((r) => r.score != null) ||
    communication.rows.some((r) => r.score != null);
  if (!speechace && !hasAnyScore) return null;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontWeight: 600, fontSize: 13 }}>Score breakdown</div>
        {runControls}
      </div>

      {speechace && (
        <div className={styles.card} style={{ display: "flex", gap: 16, fontSize: 12 }}>
          <RawScore label="Overall" value={speechace.overall} />
          <RawScore label="Pronunciation" value={speechace.pronunciation} />
          <RawScore label="Fluency" value={speechace.fluency} />
        </div>
      )}

      <ExplainerCard
        accent={scoreBarColor(currentScoreOf(global) ?? 0)}
        title={<CategoryTitle anchor="score-global" label="Global score" />}
      >
        <p style={cardCopy}>
          One holistic AI judgment across the four dimensions below, not an average — plus a flat +5% bonus if two of
          them hit 9-10/10.
        </p>
        <ComparisonTable
          metrics={[
            {
              key: "global",
              label: "Models",
              rows: global.rows,
              currentId: global.currentId,
              referenceLabel: speechace ? "Speechace" : undefined,
              referenceScore: speechace?.overall ?? null,
            },
          ]}
        />
      </ExplainerCard>

      <ExplainerCard
        accent={confidence.rows.find((r) => r.id === confidence.currentId)?.confidence
          ? CONFIDENCE_COLOR[confidence.rows.find((r) => r.id === confidence.currentId)!.confidence!]
          : undefined}
        title={<CategoryTitle anchor="score-confidence" label="Confidence" />}
      >
        <p style={cardCopy}>How sure the model is — driven mostly by how much was actually said.</p>
        <ConfidenceBadgeRows rows={confidence.rows} currentId={confidence.currentId} />
      </ExplainerCard>

      <ExplainerCard
        accent={scoreBarColor(currentScoreOf(pronunciation) ?? 0)}
        title={<CategoryTitle anchor="score-pronunciation" label="Pronunciation" />}
      >
        <p style={cardCopy}>
          From a separate system that listens to the recording, not the transcript. Two methods exist and aren&apos;t
          on the same scale.
        </p>
        <ComparisonTable
          metrics={[
            {
              key: "pronunciation",
              label: "Providers",
              rows: pronunciation.rows,
              currentId: pronunciation.currentId,
              referenceLabel: speechace ? "Speechace" : undefined,
              referenceScore: speechace?.pronunciation ?? null,
              caveat: PRONUNCIATION_CAVEAT,
            },
          ]}
        />
      </ExplainerCard>

      <ExplainerCard
        accent={scoreBarColor(currentScoreOf(fluency) ?? 0)}
        title={<CategoryTitle anchor="score-fluency" label="Fluency" />}
      >
        <p style={cardCopy}>Anchored to words-per-minute measured from the recording — not a free judgment call.</p>
        <ComparisonTable
          metrics={[{ key: "fluency", label: "Models", rows: fluency.rows, currentId: fluency.currentId }]}
        />
      </ExplainerCard>

      <ExplainerCard
        accent={scoreBarColor(currentScoreOf(vocabGrammar) ?? 0)}
        title={<CategoryTitle anchor="score-vocab" label="Vocab & Gram." />}
      >
        <p style={cardCopy}>
          Vocabulary range and grammatical accuracy from the transcript; forgiving of ASR noise when pronunciation is
          decent.
        </p>
        <ComparisonTable
          metrics={[{ key: "vocab", label: "Models", rows: vocabGrammar.rows, currentId: vocabGrammar.currentId }]}
        />
      </ExplainerCard>

      <ExplainerCard
        accent={scoreBarColor(currentScoreOf(communication) ?? 0)}
        title={<CategoryTitle anchor="score-communication" label="Communication" />}
      >
        <p style={cardCopy}>Whether the message came across clearly and questions were understood.</p>
        <ComparisonTable
          metrics={[
            { key: "communication", label: "Models", rows: communication.rows, currentId: communication.currentId },
          ]}
        />
      </ExplainerCard>
    </div>
  );
}

const cardCopy: React.CSSProperties = { fontSize: 12, lineHeight: 1.5, color: "#cbd5e1", marginTop: 0, marginBottom: 10 };

function CategoryTitle({ anchor, label }: { anchor: string; label: string }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {label}
      <a href={`/admin/scoring#${anchor}`} style={{ fontSize: 11, fontWeight: 500, color: "#93c5fd" }}>
        Learn more →
      </a>
    </span>
  );
}

function RawScore({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <div style={{ color: "#9ca3af", fontSize: 11, marginBottom: 2 }}>{label}</div>
      {value != null ? <ScorePill value={value} /> : <span style={{ color: "#6b7280" }}>—</span>}
    </div>
  );
}

function ConfidenceBadgeRows({ rows, currentId }: { rows: ConfidenceRow[]; currentId: string | null }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12 }}>
      {rows.map((r) => (
        <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>
            {r.label}
            {r.id === currentId && (
              <span style={{ marginLeft: 6, color: "#93c5fd", fontWeight: 700, fontSize: 11 }}>● current</span>
            )}
          </span>
          {r.confidence ? (
            <span
              style={{
                background: CONFIDENCE_COLOR[r.confidence],
                color: "#000",
                borderRadius: 3,
                padding: "1px 6px",
                fontWeight: 700,
                fontSize: 11,
              }}
            >
              {r.confidence.toUpperCase()}
            </span>
          ) : (
            <span style={{ color: "#6b7280", fontSize: 11 }}>not yet run</span>
          )}
        </div>
      ))}
    </div>
  );
}
