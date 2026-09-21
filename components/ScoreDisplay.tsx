import type { PronunciationResult, WordScore } from "@/lib/pronunciation/types";
import type { CefrResult, PronunciationAvg } from "@/lib/types";
import { scoreToLevel, computeCompositeCefrScore } from "@/lib/cefr-score";
import { adminColors } from "@/lib/admin-theme";

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
  theme = "dark",
}: {
  label: string;
  value: number;
  max?: number;
  /** "light" matches the "Salle claire" design (doc/new_design) — a single
   *  ink fill on a pale track, no traffic-light colouring. Default "dark"
   *  keeps the admin/dashboard look unchanged. */
  theme?: "dark" | "light";
}) {
  const pct = Math.round((value / max) * 100);
  const light = theme === "light";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, marginBottom: 3 }}>
      <span style={{ width: 80, color: light ? "#6B6F7D" : "#9ca3af", flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, height: 5, background: light ? "#E4E0D7" : "rgba(0,0,0,0.35)", borderRadius: 3 }}>
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: light ? "#141D33" : scoreBarColor(pct),
            borderRadius: 3,
            transition: "width 0.4s ease",
          }}
        />
      </div>
      <span style={{ width: 28, textAlign: "right", color: light ? "#141D33" : "#e5e7eb" }}>{Math.round(value)}</span>
    </div>
  );
}

// ─── explainer card (accent dot + anchorable id) ──────────────────────────────
// Shared by /admin/scoring (the methodology writeup) and the session detail
// page's per-category score breakdown, so both render the same card style.
// Admin-only (unlike Bar/CefrPanel below) so this always uses the admin
// light palette directly, no theme prop needed.

const explainerCardStyle: React.CSSProperties = {
  background: adminColors.surface,
  border: `1px solid ${adminColors.border}`,
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
    <div id={id} style={{ ...explainerCardStyle, borderLeft: `3px solid ${accent ?? adminColors.borderStrong}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        {accent && <span style={{ width: 8, height: 8, borderRadius: "50%", background: accent, flexShrink: 0 }} />}
        <div style={{ fontSize: 14, fontWeight: 700, color: adminColors.ink }}>{title}</div>
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
  showAllDetails = false,
  labels,
  theme = "dark",
}: {
  result: CefrResult;
  pronunciationAvg: PronunciationAvg | null;
  sourceLabel?: string;
  pronunciationSourceLabel?: string;
  /** Strengths/to-improve/notable-errors/summary — the admin detail page turns it on with showAllDetails (full lists) so the end-of-session feedback is visible in reports. */
  showDetails?: boolean;
  /** Lift the candidate-screen caps (3 strengths / 2 areas / 2 errors) — the admin report wants the evaluator's full feedback. */
  showAllDetails?: boolean;
  /** Overrides for the handful of hardcoded structural labels — defaults keep the admin view's English copy unchanged. */
  labels?: CefrPanelLabels;
  /** "light" matches the "Salle claire" design (doc/new_design) — used only
   *  by SessionResultsScreen. Default "dark" keeps the admin/dashboard
   *  detail pages unchanged. */
  theme?: "dark" | "light";
}) {
  const t = { ...DEFAULT_CEFR_LABELS, ...labels, confidence: { ...DEFAULT_CEFR_LABELS.confidence, ...labels?.confidence } };
  const light = theme === "light";
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

  const eyebrowColor = light ? "#8A8F9C" : "rgba(255,255,255,0.6)";
  const mutedColor = light ? "#8A8F9C" : "rgba(255,255,255,0.5)";
  const faintColor = light ? "#8A8F9C" : "rgba(255,255,255,0.45)";
  const bodyColor = light ? "#5A5F6E" : "rgba(255,255,255,0.7)";
  const dividerColor = light ? "1px solid #EFEBE2" : "1px solid rgba(255,255,255,0.1)";

  return (
    <div
      style={
        light
          ? { padding: 24, background: "#FFFFFF", border: "1px solid #E4E0D7", borderRadius: 14 }
          : { padding: 12, background: "linear-gradient(135deg, #1e3a8a 0%, #4f46e5 100%)", borderRadius: 8 }
      }
    >
      {/* Header row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: light ? 16 : 6 }}>
        <div>
          <div
            style={{
              fontSize: light ? 11 : 10,
              color: eyebrowColor,
              fontWeight: light ? 400 : 700,
              fontFamily: light ? "'IBM Plex Mono',monospace" : undefined,
              letterSpacing: light ? "0.12em" : 1,
            }}
          >
            {t.eyebrow}
          </div>
          <div
            style={
              light
                ? { fontSize: 48, fontWeight: 400, lineHeight: 1.1, color: "#141D33", fontFamily: "'Outfit',sans-serif" }
                : { fontSize: 36, fontWeight: 800, lineHeight: 1.1 }
            }
          >
            {compositeLevel}
          </div>
          <div style={{ fontSize: light ? 13 : 10, color: light ? "#5A5F6E" : "rgba(255,255,255,0.6)" }}>
            {t.score} {compositeScore}/100
          </div>
          {sourceLabel && <div style={{ fontSize: 10, color: faintColor, marginTop: 2 }}>via {sourceLabel}</div>}
        </div>
        <span
          style={
            light
              ? {
                  padding: "4px 10px",
                  borderRadius: 100,
                  fontSize: 11,
                  fontFamily: "'IBM Plex Mono',monospace",
                  letterSpacing: "0.06em",
                  background: "#FDF0D0",
                  border: "1px solid #F0DDA8",
                  color: "#8A6410",
                  marginTop: 4,
                }
              : {
                  padding: "2px 8px",
                  borderRadius: 10,
                  fontSize: 10,
                  fontWeight: 700,
                  background: CONFIDENCE_COLOR[result.confidence] ?? "#9ca3af",
                  color: "#000",
                  marginTop: 4,
                }
          }
        >
          {t.confidence[result.confidence] ?? result.confidence.toUpperCase()}
        </span>
      </div>

      {/* 4 equal-weight dimension bars (all 0-10) */}
      <div style={{ marginBottom: light ? 16 : 8 }}>
        {dim4.map(([label, val]) =>
          val !== null ? (
            <Bar key={label} label={label} value={val} max={10} theme={theme} />
          ) : (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, marginBottom: 3 }}>
              <span style={{ width: 80, color: light ? "#6B6F7D" : "#9ca3af", flexShrink: 0 }}>{label}</span>
              <span style={{ color: light ? "#8A8F9C" : "#4b5563", fontSize: 10 }}>n/a</span>
            </div>
          )
        )}
      </div>
      {pronunciationAvg && pronunciationSourceLabel && (
        <div style={{ fontSize: 10, color: faintColor, marginTop: -4, marginBottom: light ? 16 : 8 }}>
          Pronunciation via {pronunciationSourceLabel}
        </div>
      )}

      {showDetails && (
        <>
          {/* Strengths */}
          {result.strengths?.length > 0 && (
            <div style={{ marginBottom: light ? 12 : 6 }}>
              <div style={{ fontSize: light ? 12 : 10, color: mutedColor, marginBottom: 2 }}>{t.strengths}</div>
              <ul style={{ margin: 0, paddingLeft: 14, fontSize: light ? 14 : 11, lineHeight: 1.5, color: light ? "#141D33" : undefined }}>
                {result.strengths.slice(0, showAllDetails ? undefined : 3).map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}

          {/* Areas for improvement */}
          {result.areas_for_improvement?.length > 0 && (
            <div style={{ marginBottom: light ? 12 : 6 }}>
              <div style={{ fontSize: light ? 12 : 10, color: mutedColor, marginBottom: 2 }}>{t.toImprove}</div>
              <ul style={{ margin: 0, paddingLeft: 14, fontSize: light ? 14 : 11, lineHeight: 1.5, color: light ? "#141D33" : undefined }}>
                {result.areas_for_improvement.slice(0, showAllDetails ? undefined : 2).map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}

          {/* Notable errors */}
          {result.notable_errors?.length > 0 && (
            <div style={{ marginBottom: light ? 12 : 6 }}>
              <div style={{ fontSize: light ? 12 : 10, color: mutedColor, marginBottom: 2 }}>{t.notableErrors}</div>
              <ul style={{ margin: 0, paddingLeft: 14, fontSize: light ? 14 : 11, lineHeight: 1.5, color: light ? "#B3542E" : "#fca5a5" }}>
                {result.notable_errors.slice(0, showAllDetails ? undefined : 2).map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}

          {/* Summary */}
          {result.summary && (
            <div style={{ fontSize: light ? 14 : 11, color: bodyColor, lineHeight: 1.5, borderTop: dividerColor, paddingTop: light ? 12 : 6 }}>
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
            ? "Scored by Azure + Deepgram, judged by Mistral"
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
