import type { PronunciationResult, WordScore } from "@/lib/azure-stt";
import type { CefrResult, PronunciationAvg } from "@/lib/types";
import { scoreToLevel, computeCompositeCefrScore } from "@/lib/cefr-score";

export { scoreToLevel };

// Shared between the live conversation UI (app/page.tsx) and the admin
// replay view (app/admin/[id]/page.tsx) so both render scores identically —
// no hooks/browser APIs here, so this is safe to import from server
// components too.

export type { CefrResult, PronunciationAvg };

// ─── colour helpers ──────────────────────────────────────────────────────────

export function wordColor(score: number): string {
  if (score >= 80) return "#4ade80";
  if (score >= 60) return "#facc15";
  if (score >= 40) return "#fb923c";
  return "#f87171";
}

export function scoreBarColor(score: number): string {
  if (score >= 80) return "#4ade80";
  if (score >= 60) return "#facc15";
  return "#fb923c";
}

export const CONFIDENCE_COLOR: Record<string, string> = {
  high: "#4ade80",
  medium: "#facc15",
  low: "#fb923c",
};

// ─── small reusable bar ───────────────────────────────────────────────────────

export function Bar({
  label,
  value,
  max = 100,
}: {
  label: string;
  value: number;
  max?: number;
}) {
  const pct = Math.round((value / max) * 100);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, marginBottom: 3 }}>
      <span style={{ width: 80, color: "#9ca3af", flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, height: 5, background: "rgba(0,0,0,0.35)", borderRadius: 3 }}>
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: scoreBarColor(pct),
            borderRadius: 3,
            transition: "width 0.4s ease",
          }}
        />
      </div>
      <span style={{ width: 28, textAlign: "right", color: "#e5e7eb" }}>{Math.round(value)}</span>
    </div>
  );
}

// ─── explainer card (accent dot + anchorable id) ──────────────────────────────
// Shared by /admin/scoring (the methodology writeup) and the session detail
// page's per-category score breakdown, so both render the same card style.

const explainerCardStyle: React.CSSProperties = {
  background: "#111827",
  border: "1px solid #1e293b",
  borderRadius: 10,
  padding: "14px 18px",
  marginBottom: 14,
  scrollMarginTop: 20,
};

export function ExplainerCard({
  id,
  accent,
  title,
  children,
}: {
  id?: string;
  accent?: string;
  title: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div id={id} style={{ ...explainerCardStyle, borderLeft: `3px solid ${accent ?? "#334155"}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        {accent && <span style={{ width: 8, height: 8, borderRadius: "50%", background: accent, flexShrink: 0 }} />}
        <div style={{ fontSize: 14, fontWeight: 700, color: "#e5e7eb" }}>{title}</div>
      </div>
      {children}
    </div>
  );
}

// ─── CEFR panel ────────────────────────────────────────────────────────────

const DEFAULT_CEFR_LABELS = {
  eyebrow: "ORAL ASSESSMENT",
  score: "Score",
  strengths: "Strengths",
  toImprove: "To improve",
  notableErrors: "Notable errors",
  confidence: { high: "HIGH", medium: "MEDIUM", low: "LOW" } as Record<string, string>,
};

export type CefrPanelLabels = Partial<typeof DEFAULT_CEFR_LABELS>;

export function CefrPanel({
  result,
  pronunciationAvg,
  sourceLabel,
  pronunciationSourceLabel,
  showDetails = true,
  labels,
}: {
  result: CefrResult;
  pronunciationAvg: PronunciationAvg | null;
  sourceLabel?: string;
  pronunciationSourceLabel?: string;
  /** Strengths/to-improve/notable-errors/summary — off on the admin detail page, where lib/score-breakdown.ts's panel covers that ground per-category instead. */
  showDetails?: boolean;
  /** Overrides for the handful of hardcoded structural labels — defaults keep the admin view's English copy unchanged. */
  labels?: CefrPanelLabels;
}) {
  const t = { ...DEFAULT_CEFR_LABELS, ...labels, confidence: { ...DEFAULT_CEFR_LABELS.confidence, ...labels?.confidence } };
  // All 4 components on a 0-10 scale for uniform bar display
  const pronScore  = pronunciationAvg  ? pronunciationAvg.pronunciation / 10 : null;
  const fluency    = result.dimensions.fluency;
  const vocabGram  = result.dimensions.vocabulary_grammar;
  const comm       = result.dimensions.communication;

  const { score: compositeScore, level: compositeLevel } = computeCompositeCefrScore(result, pronunciationAvg);

  const dim4: [string, number | null][] = [
    ["Pronunciation", pronScore],
    ["Fluency",       fluency],
    ["Vocab & Gram.", vocabGram],
    ["Communication", comm],
  ];

  return (
    <div
      style={{
        padding: 12,
        background: "linear-gradient(135deg, #1e3a8a 0%, #4f46e5 100%)",
        borderRadius: 8,
      }}
    >
      {/* Header row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
        <div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.6)", fontWeight: 700, letterSpacing: 1 }}>
            {t.eyebrow}
          </div>
          <div style={{ fontSize: 36, fontWeight: 800, lineHeight: 1.1 }}>{compositeLevel}</div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.6)" }}>
            {t.score} {compositeScore}/100
          </div>
          {sourceLabel && (
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", marginTop: 2 }}>via {sourceLabel}</div>
          )}
        </div>
        <span
          style={{
            padding: "2px 8px",
            borderRadius: 10,
            fontSize: 10,
            fontWeight: 700,
            background: CONFIDENCE_COLOR[result.confidence] ?? "#9ca3af",
            color: "#000",
            marginTop: 4,
          }}
        >
          {t.confidence[result.confidence] ?? result.confidence.toUpperCase()}
        </span>
      </div>

      {/* 4 equal-weight dimension bars (all 0-10) */}
      <div style={{ marginBottom: 8 }}>
        {dim4.map(([label, val]) =>
          val !== null ? (
            <Bar key={label} label={label} value={val} max={10} />
          ) : (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, marginBottom: 3 }}>
              <span style={{ width: 80, color: "#9ca3af", flexShrink: 0 }}>{label}</span>
              <span style={{ color: "#4b5563", fontSize: 10 }}>n/a</span>
            </div>
          )
        )}
      </div>
      {pronunciationAvg && pronunciationSourceLabel && (
        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", marginTop: -4, marginBottom: 8 }}>
          Pronunciation via {pronunciationSourceLabel}
        </div>
      )}

      {showDetails && (
        <>
          {/* Strengths */}
          {result.strengths?.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", marginBottom: 2 }}>{t.strengths}</div>
              <ul style={{ margin: 0, paddingLeft: 14, fontSize: 11, lineHeight: 1.5 }}>
                {result.strengths.slice(0, 3).map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}

          {/* Areas for improvement */}
          {result.areas_for_improvement?.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", marginBottom: 2 }}>{t.toImprove}</div>
              <ul style={{ margin: 0, paddingLeft: 14, fontSize: 11, lineHeight: 1.5 }}>
                {result.areas_for_improvement.slice(0, 2).map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}

          {/* Notable errors */}
          {result.notable_errors?.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", marginBottom: 2 }}>{t.notableErrors}</div>
              <ul style={{ margin: 0, paddingLeft: 14, fontSize: 11, lineHeight: 1.5, color: "#fca5a5" }}>
                {result.notable_errors.slice(0, 2).map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}

          {/* Summary */}
          {result.summary && (
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.7)", lineHeight: 1.5, borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: 6 }}>
              {result.summary}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Utterance mini-badges ────────────────────────────────────────────────────

export function UtteranceBadges({ p }: { p: PronunciationResult }) {
  const dims: [string, number, string][] = [
    ["P", p.pronunciationScore, "Pronunciation confidence"],
    ["W", p.wpm, "Words per minute"],
  ];
  return (
    <div style={{ display: "flex", gap: 4, marginTop: 4, flexWrap: "wrap" }}>
      {dims.map(([lbl, val, title]) => (
        <span
          key={lbl}
          title={`${title}: ${Math.round(val)}/100`}
          style={{
            background: wordColor(val),
            color: "#000",
            borderRadius: 3,
            padding: "1px 5px",
            fontSize: 10,
            fontWeight: 700,
            cursor: "help",
          }}
        >
          {lbl}
          {Math.round(val)}
        </span>
      ))}
      {/* Source badge: which pronunciation provider actually produced this score. */}
      <span
        title={
          p.source === "azure"
            ? "Scored by Azure Pronunciation Assessment (phoneme-level)"
            : p.source === "voxtral"
            ? "Scored by Voxtral (Mistral direct-audio judge)"
            : "Scored by Deepgram confidence — Azure assessment pending"
        }
        style={{
          background: p.source === "azure" ? "#60a5fa" : p.source === "voxtral" ? "#c084fc" : "#475569",
          color: p.source === "azure" || p.source === "voxtral" ? "#000" : "#cbd5e1",
          borderRadius: 3,
          padding: "1px 5px",
          fontSize: 10,
          fontWeight: 700,
          cursor: "help",
        }}
      >
        {p.source === "azure" ? "AZ" : p.source === "voxtral" ? "VX" : "DG"}
      </span>
    </div>
  );
}

// ─── Word-annotated user message ──────────────────────────────────────────────

export function UserWords({ words }: { words: WordScore[] }) {
  if (!words.length) return null;
  return (
    <>
      {words.map((w, i) => {
        const pct = Math.round(w.confidence * 100);
        const label = pct >= 80 ? "correct" : pct >= 60 ? "acceptable" : pct >= 35 ? "mispronounced" : "incorrect";
        return (
          <span
            key={i}
            title={`${w.word}: ${label}`}
            style={{
              color: wordColor(pct),
              marginRight: 4,
              cursor: "help",
              textDecoration: w.confidence < 0.7 ? "underline dotted" : "none",
            }}
          >
            {w.word}
          </span>
        );
      })}
    </>
  );
}
