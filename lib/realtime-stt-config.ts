/**
 * Single source of truth for whether the client streams audio to Mistral's
 * realtime STT (lib/realtime-stt.ts) instead of waiting for the user to
 * finish and POSTing a batch clip to /api/transcribe. Same "the constant IS
 * the switch" pattern as lib/stt/registry.ts's LIVE_STT_PROVIDER_ID — flip
 * this to false to fall back to the batch path everywhere at once, no other
 * code changes needed (app/page.tsx already falls back automatically on any
 * realtime failure/timeout regardless of this flag).
 */
export const REALTIME_STT_ENABLED = true;
