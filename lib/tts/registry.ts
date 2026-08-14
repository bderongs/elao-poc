import type { TtsProvider } from "./types";
import type { ConvLang } from "@/lib/conversation-prompts";
import { azureTtsProvider } from "./providers/azure";
import { mistralTtsProvider } from "./providers/mistral";

// Same shape as lib/pronunciation/registry.ts, lib/llm/registry.ts,
// lib/stt/registry.ts, and lib/et/registry.ts — see lib/system-config.ts
// for the aggregator.
const PROVIDERS: Record<string, TtsProvider> = {
  azure: azureTtsProvider,
  mistral: mistralTtsProvider,
};

/**
 * The single source of truth for which provider is live PER LANGUAGE — TTS
 * is the one capability where "live" isn't a single global pick.
 * app/api/chat/route.ts calls
 * getProvider(LIVE_TTS_PROVIDER_BY_LANG[language]) directly, so this map IS
 * the switch. Mistral only has preset voices for en/fr today (see
 * lib/tts/providers/mistral.ts) — the other four languages stay on Azure.
 * DEV-PLAN.md Track M has the follow-up to close this gap.
 */
export const LIVE_TTS_PROVIDER_BY_LANG: Record<ConvLang, string> = {
  en: "mistral",
  fr: "mistral",
  "nl-BE": "azure",
  es: "azure",
  it: "azure",
  de: "azure",
};

export function getProvider(id: string): TtsProvider {
  const provider = PROVIDERS[id];
  if (!provider) throw new Error(`Unknown TTS provider: ${id}`);
  return provider;
}

export function listProviders(): TtsProvider[] {
  return Object.values(PROVIDERS);
}
