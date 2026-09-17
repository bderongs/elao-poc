/**
 * Shared color tokens for the admin section, mirroring the light design
 * system used by the main conversation flow (see doc/new_design/README.md).
 * The dark sidebar* tokens are the exception: the left nav stays dark so
 * it's immediately obvious you're in the admin area, not the user app.
 */
export const adminColors = {
  bg: "#F7F5F0",
  surface: "#FFFFFF",
  panel: "#F1EEE6",
  ink: "#141D33",
  inkHover: "#243052",
  text: "#5A5F6E",
  muted: "#6B6F7D",
  faint: "#8A8F9C",
  border: "#DDD9D0",
  borderStrong: "#C9C4B8",
  hairline: "#EFEBE2",
  accent: "#F5B921",
  accentTint: "#FDF0D0",
  accentBorder: "#F0DDA8",
  accentInk: "#8A6410",
  success: "#2F9E6E",
  danger: "#B3261E",
  dangerBg: "#FBEAE9",
  dangerBorder: "#F1C4C0",
  warning: "#8A6410",
  warningBg: "#FDF0D0",
  sidebarBg: "#141D33",
  sidebarText: "#E8EAF0",
  sidebarMuted: "#9AA3B8",
  sidebarBorder: "rgba(255,255,255,0.08)",
  sidebarActiveBg: "rgba(245,185,33,0.16)",
  sidebarActiveAccent: "#F5B921",
} as const;
