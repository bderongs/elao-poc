import type { SttProvider } from "./types";
import { voxtralSttProvider } from "./providers/voxtral";

// Same shape as lib/pronunciation/registry.ts and lib/llm/registry.ts — see
// lib/system-config.ts for the aggregator that surfaces all of these in the
// admin UI and per-session records.
const PROVIDERS: Record<string, SttProvider> = {
  voxtral: voxtralSttProvider,
};

/**
 * The single source of truth for which provider is live —
 * app/api/transcribe/route.ts calls getProvider(LIVE_STT_PROVIDER_ID)
 * directly, so this constant IS the switch, not just a label for one.
 */
export const LIVE_STT_PROVIDER_ID = "voxtral";

export function getProvider(id: string): SttProvider {
  const provider = PROVIDERS[id];
  if (!provider) throw new Error(`Unknown STT provider: ${id}`);
  return provider;
}

export function listProviders(): SttProvider[] {
  return Object.values(PROVIDERS);
}
