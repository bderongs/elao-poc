import type { EtProvider } from "./types";
import { mistralEtProvider } from "./providers/mistral";

// Same shape as lib/pronunciation/registry.ts, lib/llm/registry.ts, and
// lib/stt/registry.ts — see lib/system-config.ts for the aggregator.
const PROVIDERS: Record<string, EtProvider> = {
  mistral: mistralEtProvider,
};

/**
 * The single source of truth for which provider is live —
 * app/api/assess-transcript/route.ts calls getProvider(LIVE_ET_PROVIDER_ID)
 * directly, so this constant IS the switch, not just a label for one.
 */
export const LIVE_ET_PROVIDER_ID = "mistral";

export function getProvider(id: string): EtProvider {
  const provider = PROVIDERS[id];
  if (!provider) throw new Error(`Unknown ET provider: ${id}`);
  return provider;
}

export function listProviders(): EtProvider[] {
  return Object.values(PROVIDERS);
}
