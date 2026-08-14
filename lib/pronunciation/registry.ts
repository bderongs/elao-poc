import type { PronunciationProvider } from "./types";
import { azureEnsembleProvider } from "./providers/azure-ensemble";
import { voxtralProvider } from "./providers/voxtral";

// Order here drives display order in the admin gear (listProviders()) —
// azure-ensemble first since it's the live/headline default
// (LIVE_CONVERSATION_PRONUNCIATION_PROVIDER_ID in lib/pronunciation-rollup.ts),
// voxtral second as the on-demand comparison run.
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
