/**
 * Single source of truth for session-level constants shared by the live
 * conversation UI (app/page.tsx) and the system prompts
 * (lib/conversation-prompts.ts). The duration is meant to grow to 5 minutes
 * later — change it here only.
 */
import type { SessionLengthMode } from "@/lib/session-length";

export const SESSION_DURATION_MINUTES = 3;
export const SESSION_DURATION_SECONDS = SESSION_DURATION_MINUTES * 60;

/**
 * Adaptive session length (Track AC, lib/session-length.ts) — the constant IS
 * the switch. "shadow": sessions still last SESSION_DURATION_SECONDS (or the
 * `?minutes=` override), the stop rule only records where it would have
 * stopped. "adaptive": the session ends once the level has settled, between
 * SESSION_MIN_SECONDS and SESSION_MAX_SECONDS. "fixed": rule off.
 */
export const SESSION_LENGTH_MODE: SessionLengthMode = "adaptive";
export const SESSION_MIN_SECONDS = 3 * 60;
export const SESSION_MAX_SECONDS = 7 * 60;

/** Length wording for the French landing screen: "quelques minutes" when the length adapts, otherwise "N minutes". */
export const SESSION_LENGTH_LABEL_FR =
  SESSION_LENGTH_MODE === "adaptive" ? "quelques minutes" : `${SESSION_DURATION_MINUTES} minutes`;

/** The examiner's first name — every language's avatar introduces itself with it. */
export const AVATAR_NAME = "Léa";
