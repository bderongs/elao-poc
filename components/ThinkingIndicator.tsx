"use client";

interface ThinkingIndicatorProps {
  /**
   * "badge" — standalone pill with a spinner + label, for overlaying the avatar.
   * "inline" — compact spinner only, sized to sit next to existing button text.
   */
  variant?: "badge" | "inline";
  label?: string;
}

/**
 * Lightweight loading cue for the gap between end-of-speech and the avatar's
 * first reply token (and for the final evaluation wait) — there was
 * previously zero visual feedback during these waits. No new dependency: a
 * plain <style> tag carries the @keyframes, since CSSProperties objects can't
 * express one and this repo has no CSS-module/animation convention to reuse.
 */
export function ThinkingIndicator({ variant = "badge", label = "…" }: ThinkingIndicatorProps) {
  const size = variant === "inline" ? 12 : 16;
  return (
    <span
      style={
        variant === "badge"
          ? {
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 12px",
              borderRadius: 999,
              background: "rgba(15, 23, 42, 0.72)",
              backdropFilter: "blur(4px)",
              color: "#e2e8f0",
              fontSize: 13,
            }
          : { display: "inline-flex", alignItems: "center" }
      }
    >
      <style>{`
        @keyframes elaoThinkingSpin {
          to { transform: rotate(360deg); }
        }
      `}</style>
      <span
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          border: "2px solid rgba(226, 232, 240, 0.35)",
          borderTopColor: "#e2e8f0",
          animation: "elaoThinkingSpin 0.8s linear infinite",
        }}
      />
      {variant === "badge" && <span>{label}</span>}
    </span>
  );
}
