import type { PronunciationProvider } from "./types";
import { azureEnsembleProvider } from "./providers/azure-ensemble";
import { voxtralProvider } from "./providers/voxtral";

// Order here drives display order in the admin gear (listProviders()) — voxtral
// first since it's the live/headline default (LIVE_CONVERSATION_PRONUNCIATION_PROVIDER_ID
// in lib/pronunciation-rollup.ts), azure-ensemble second as the on-demand
// comparison run.
const PROVIDERS: Record<string, PronunciationProvider> = {
  voxtral: voxtralProvider,
  "azure-ensemble": azureEnsembleProvider,
};

export function getProvider(id: string): PronunciationProvider {
  const provider = PROVIDERS[id];
  if (!provider) throw new Error(`Unknown pronunciation provider: ${id}`);
  return provider;
}

export function listProviders(): PronunciationProvider[] {
  return Object.values(PROVIDERS);
}
