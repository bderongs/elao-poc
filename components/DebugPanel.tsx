import { useState } from "react";
import { CEFR_LADDER, zoneForRung, type CefrRung, type CefrZone } from "@/lib/cefr-rung";

/**
 * `?debug=1` dev panel (see doc plan "debug visibility"): a live, fixed
 * right-hand sidebar showing the transcript plus each turn's ET verdict and
 * rung transition, so it's possible to see WHY the system moved the
 * difficulty rung the way it did during a live session instead of only
 * inferring it from the final score. Client-side/ephemeral only — nothing
 * here is persisted, it just mirrors app/page.tsx's in-memory state.
 */

export type DebugEvent = {
  questionAsked: string;
  userAnswer: string;
  previousRung: CefrRung;
  nextRung: CefrRung;
  verdict: string;
  zone: CefrZone;
};

type TranscriptMsg = { role: "user" | "assistant"; content: string };

const ZONE_LABEL: Record<CefrZone, string> = {
  foundation: "Foundation (A1–A2)",
  core: "Core (B1–C1)",
  mastery: "Mastery (C2)",
};

const ZONE_COLOR: Record<CefrZone, string> = {
  foundation: "#fb923c",
  core: "#4ade80",
  mastery: "#a78bfa",
};

const VERDICT_COLOR: Record<string, string> = {
  well: "#4ade80",
  adequate: "#facc15",
  struggled: "#f87171",
};

function rungGlyph(previous: CefrRung, next: CefrRung): string {
  if (previous === next) return "→";
  return CEFR_LADDER.indexOf(next) > CEFR_LADDER.indexOf(previous) ? "↑" : "↓";
}

export function DebugPanel({
  transcript,
  currentRung,
  events,
}: {
  transcript: TranscriptMsg[];
  currentRung: CefrRung;
  events: DebugEvent[];
}) {
  const zone = zoneForRung(currentRung);
  const [collapsed, setCollapsed] = useState(false);

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        title="Expand debug panel"
        style={{
          position: "fixed",
          top: 16,
          right: 0,
          zIndex: 9999,
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: "#0F1420",
          color: "#E4E7EF",
          border: "1px solid #2A3348",
          borderRight: "none",
          borderRadius: "6px 0 0 6px",
          padding: "6px 10px",
          fontFamily: "'SF Mono',Menlo,monospace",
          fontSize: 12,
          cursor: "pointer",
        }}
      >
        <span>◀</span>
        <span style={{ fontWeight: 700 }}>{currentRung}</span>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: ZONE_COLOR[zone],
            display: "inline-block",
          }}
        />
      </button>
    );
  }

  return (
    <aside
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        width: 340,
        height: "100vh",
        overflowY: "auto",
        background: "#0F1420",
        color: "#E4E7EF",
        fontFamily: "'SF Mono',Menlo,monospace",
        fontSize: 12,
        lineHeight: 1.5,
        padding: 16,
        boxSizing: "border-box",
        zIndex: 9999,
        borderLeft: "1px solid #2A3348",
      }}
    >
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>Debug panel</div>
          <button
            onClick={() => setCollapsed(true)}
            title="Collapse debug panel"
            style={{
              background: "none",
              border: "1px solid #2A3348",
              borderRadius: 4,
              color: "#8B93A7",
              fontSize: 11,
              padding: "2px 6px",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            ▶
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 20, fontWeight: 700 }}>{currentRung}</span>
          <span
            style={{
              fontSize: 10,
              padding: "2px 6px",
              borderRadius: 4,
              background: ZONE_COLOR[zone],
              color: "#0F1420",
              fontWeight: 700,
            }}
          >
            {ZONE_LABEL[zone]}
          </span>
        </div>
        <div style={{ color: "#8B93A7" }}>{events.length} ET result{events.length === 1 ? "" : "s"}</div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#8B93A7", marginBottom: 6, textTransform: "uppercase" }}>
          Transcript
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {transcript.length === 0 && <div style={{ color: "#5A6178" }}>(empty)</div>}
          {transcript.map((m, i) => (
            <div key={i}>
              <span style={{ color: m.role === "user" ? "#60A5FA" : "#8B93A7", fontWeight: 700 }}>
                {m.role === "user" ? "USER" : "LÉA"}
              </span>{" "}
              <span>{m.content}</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#8B93A7", marginBottom: 6, textTransform: "uppercase" }}>
          ET verdicts
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {events.length === 0 && <div style={{ color: "#5A6178" }}>(none yet)</div>}
          {events.map((e, i) => (
            <div key={i} style={{ borderTop: "1px solid #2A3348", paddingTop: 8 }}>
              <div style={{ color: "#8B93A7", marginBottom: 2 }}>Q: {e.questionAsked}</div>
              <div style={{ marginBottom: 4 }}>A: {e.userAnswer}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ color: VERDICT_COLOR[e.verdict] ?? "#E4E7EF", fontWeight: 700 }}>{e.verdict}</span>
                <span>
                  {e.previousRung} {rungGlyph(e.previousRung, e.nextRung)} {e.nextRung}
                </span>
                <span style={{ color: ZONE_COLOR[e.zone], fontSize: 10 }}>{ZONE_LABEL[e.zone]}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}

/**
 * Shown on every page other than the live conversation (see GlobalDebugPanel,
 * mounted in the root layout) — there's no transcript/rung/verdict data
 * outside a session, so this just confirms debug mode is on and surfaces the
 * `?level=` override, if any, since that's the one other debug-relevant flag
 * that can be set from any page's URL.
 */
export function MinimalDebugPanel({ level }: { level: CefrRung | null }) {
  const [collapsed, setCollapsed] = useState(false);

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        title="Expand debug panel"
        style={{
          position: "fixed",
          top: 16,
          right: 0,
          zIndex: 9999,
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: "#0F1420",
          color: "#E4E7EF",
          border: "1px solid #2A3348",
          borderRight: "none",
          borderRadius: "6px 0 0 6px",
          padding: "6px 10px",
          fontFamily: "'SF Mono',Menlo,monospace",
          fontSize: 12,
          cursor: "pointer",
        }}
      >
        <span>◀</span>
        <span style={{ fontWeight: 700 }}>{level ?? "debug"}</span>
      </button>
    );
  }

  return (
    <aside
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        width: 220,
        overflowY: "auto",
        background: "#0F1420",
        color: "#E4E7EF",
        fontFamily: "'SF Mono',Menlo,monospace",
        fontSize: 12,
        lineHeight: 1.5,
        padding: 16,
        boxSizing: "border-box",
        zIndex: 9999,
        borderLeft: "1px solid #2A3348",
        borderBottom: "1px solid #2A3348",
        borderBottomLeftRadius: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>Debug panel</div>
        <button
          onClick={() => setCollapsed(true)}
          title="Collapse debug panel"
          style={{
            background: "none",
            border: "1px solid #2A3348",
            borderRadius: 4,
            color: "#8B93A7",
            fontSize: 11,
            padding: "2px 6px",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          ▶
        </button>
      </div>
      <div style={{ color: "#8B93A7", marginBottom: 4, fontSize: 11, textTransform: "uppercase" }}>?level=</div>
      <div style={{ fontSize: 16, fontWeight: 700 }}>{level ?? "—"}</div>
    </aside>
  );
}
