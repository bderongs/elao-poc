import type { PronunciationResult, WordScore } from "@/lib/azure-stt";

// Shared between the live conversation UI (app/page.tsx) and the admin
// replay view (app/admin/[id]/page.tsx) so both render scores identically —
// no hooks/browser APIs here, so this is safe to import from server
// components too.

export interface CefrResult {
  candidate: string;
  language: string;
  level: string;
  score_percent: number;
  confidence: "high" | "medium" | "low";
  dimensions: {
    fluency: number | null;
    vocabulary_grammar: number | null;
    communication: number | null;
  };
  strengths: string[];
  areas_for_improvement: string[];
  notable_errors: string[];
  summary: string;
}

export interface AzureAvg {
  pronunciation: number;
  wpm: number;
  score: number;
  count: number;
  /** Turns with < 6 words — each deducts 0.5 from the fluency dimension. */
  shortTurns: number;
}

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

/** Derive CEFR level from composite score (5-point bands). */
export function scoreToLevel(score: number): string {
  if (score >= 90) return "C2";
  if (score >= 85) return "C1+";
  if (score >= 80) return "C1";
  if (score >= 75) return "B2+";
  if (score >= 70) return "B2";
  if (score >= 65) return "B1+";
  if (score >= 60) return "B1";
  if (score >= 55) return "A2+";
  if (score >= 50) return "A2";
  if (score >= 45) return "A1+";
  if (score >= 40) return "A1";
  return "A0";
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

// ─── CEFR panel ────────────────────────────────────────────────────────────

export function CefrPanel({ result, azureAvg }: { result: CefrResult; azureAvg: AzureAvg | null }) {
  // All 4 components on a 0-10 scale for uniform bar display
  const pronScore  = azureAvg  ? azureAvg.pronunciation / 10 : null;
  const fluency    = result.dimensions.fluency;
  const vocabGram  = result.dimensions.vocabulary_grammar;
  const comm       = result.dimensions.communication;

  // Use the evaluator's score and level directly — it already accounts for all
  // dimensions holistically.
  const baseScore = result.score_percent;

  // Excellence bonus: when at least 2 of the 4 criteria reach 9/10, pull the
  // overall score up by 5%. Two standout dimensions signal a stronger candidate
  // than a flat profile at the same average — reward that. Counts 9 and 10.
  const highCount = [pronScore, fluency, vocabGram, comm].filter(
    (v): v is number => v !== null && v >= 9
  ).length;
  const compositeScore = highCount >= 2
    ? Math.min(100, Math.round(baseScore * 1.05))
    : baseScore;
  // Recompute the level from the boosted score so the label and number agree.
  const compositeLevel = compositeScore !== baseScore
    ? scoreToLevel(compositeScore)
    : (result.level ?? scoreToLevel(compositeScore));

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
            ORAL ASSESSMENT
          </div>
          <div style={{ fontSize: 36, fontWeight: 800, lineHeight: 1.1 }}>{compositeLevel}</div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.6)" }}>
            Score {compositeScore}/100
          </div>
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
          {result.confidence.toUpperCase()}
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

      {/* Strengths */}
      {result.strengths?.length > 0 && (
        <div style={{ marginBottom: 6 }}>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", marginBottom: 2 }}>Strengths</div>
          <ul style={{ margin: 0, paddingLeft: 14, fontSize: 11, lineHeight: 1.5 }}>
            {result.strengths.slice(0, 3).map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        </div>
      )}

      {/* Areas for improvement */}
      {result.areas_for_improvement?.length > 0 && (
        <div style={{ marginBottom: 6 }}>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", marginBottom: 2 }}>To improve</div>
          <ul style={{ margin: 0, paddingLeft: 14, fontSize: 11, lineHeight: 1.5 }}>
            {result.areas_for_improvement.slice(0, 2).map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        </div>
      )}

      {/* Notable errors */}
      {result.notable_errors?.length > 0 && (
        <div style={{ marginBottom: 6 }}>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", marginBottom: 2 }}>Notable errors</div>
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
      {/* Source badge: DG = Deepgram confidence proxy (pending Azure), AZ = Azure phoneme scores */}
      <span
        title={
          p.source === "azure"
            ? "Scored by Azure Pronunciation Assessment (phoneme-level)"
            : "Scored by Deepgram confidence — Azure assessment pending"
        }
        style={{
          background: p.source === "azure" ? "#60a5fa" : "#475569",
          color: p.source === "azure" ? "#000" : "#cbd5e1",
          borderRadius: 3,
          padding: "1px 5px",
          fontSize: 10,
          fontWeight: 700,
          cursor: "help",
        }}
      >
        {p.source === "azure" ? "AZ" : "DG"}
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
