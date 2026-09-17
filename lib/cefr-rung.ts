/**
 * The CEFR difficulty rung type + guard, split out from lib/level-assessment.ts
 * specifically so client components (app/page.tsx) can import it without
 * pulling in that file's server-only deps (lib/mistral.ts, lib/server-log.ts —
 * Node fs/path, API keys). This file must stay free of any server-only import.
 */

export type CefrRung = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";

export const CEFR_LADDER: CefrRung[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

export function isCefrRung(value: unknown): value is CefrRung {
  return typeof value === "string" && (CEFR_LADDER as string[]).includes(value);
}

/** The three zones a rung falls into (doc/adaptive-levels-plan.md §3) — single
 *  source of truth for the A1/A2 "Foundation" and C2 "Mastery" boundaries. */
export type CefrZone = "foundation" | "core" | "mastery";

export function zoneForRung(rung: CefrRung): CefrZone {
  if (rung === "A1" || rung === "A2") return "foundation";
  if (rung === "C2") return "mastery";
  return "core";
}
