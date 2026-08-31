import type { PronunciationProvider } from "./types";
import { azureEnsembleProvider } from "./providers/azure-ensemble";
import { voxtralProvider } from "./providers/voxtral";

// Order here drives display order in the admin gear (listProviders()) —
// azure-ensemble first, voxtral second. Which one is actually live is
// per-language (LIVE_CONVERSATION_PRONUNCIATION_PROVIDER_BY_LANG in
// lib/pronunciation-rollup.ts); whichever isn't live for a given language
// remains available as an on-demand comparison run from the admin gear.
const PROVIDERS: Record<string, PronunciationProvider> = {
  "azure-ensemble": azureEnsembleProvider,
  voxtral: voxtralProvider,
};

export function getProvider(id: string): PronunciationProvider {
  const provider = PROVIDERS[id];
  if (!provider) throw new Error(`Unknown pronunciation provider: ${id}`);
  return provider;
}

export function listProviders(): PronunciationProvider[] {
  return Object.values(PROVIDERS);
}
