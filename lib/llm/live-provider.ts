/**
 * Which lib/llm/registry.ts provider is live for the end-of-session CEFR
 * evaluation — app/api/evaluate/route.ts calls
 * getProvider(LIVE_CONVERSATION_MODEL_ID) directly, so this constant IS the
 * switch, not just a label for one. Was "mistral" since the original prompts
 * were tuned against it (see lib/llm/providers/anthropic.ts).
 *
 * Deliberately standalone (no other imports) to avoid a circular import:
 * lib/cefr-eval.ts (which re-exports this) imports lib/sessions-service.ts
 * for its admin-replay helpers, and lib/system-config.ts — imported BY
 * lib/sessions-service.ts, for the per-session providers_json snapshot —
 * needs this constant too.
 */
export const LIVE_CONVERSATION_MODEL_ID = "mistral";
