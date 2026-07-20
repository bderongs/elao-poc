import type { LlmProvider } from "./types";
import { mistralProvider } from "./providers/mistral";
import { anthropicProvider } from "./providers/anthropic";

const PROVIDERS: Record<string, LlmProvider> = {
  mistral: mistralProvider,
  anthropic: anthropicProvider,
};

export function getProvider(id: string): LlmProvider {
  const provider = PROVIDERS[id];
  if (!provider) throw new Error(`Unknown LLM provider: ${id}`);
  return provider;
}

export function listProviders(): LlmProvider[] {
  return Object.values(PROVIDERS);
}
