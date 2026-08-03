import type { PronunciationProvider } from "./types";
import { azureEnsembleProvider } from "./providers/azure-ensemble";
import { voxtralProvider } from "./providers/voxtral";

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
