/**
 * Single source of truth for session-level constants shared by the live
 * conversation UI (app/page.tsx) and the system prompts
 * (lib/conversation-prompts.ts). The duration is meant to grow to 5 minutes
 * later — change it here only.
 */
export const SESSION_DURATION_MINUTES = 3;
export const SESSION_DURATION_SECONDS = SESSION_DURATION_MINUTES * 60;

/** The examiner's first name — every language's avatar introduces itself with it. */
export const AVATAR_NAME = "Léa";
