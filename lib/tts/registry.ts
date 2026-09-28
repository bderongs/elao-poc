import type { TtsProvider } from "./types";
import type { ConvLang } from "@/lib/conversation-prompts";
import { azureTtsProvider } from "./providers/azure";
import { gradiumTtsProvider } from "./providers/gradium";
import { mistralTtsProvider } from "./providers/mistral";

// Same shape as lib/pronunciation/registry.ts, lib/llm/registry.ts,
// lib/stt/registry.ts, and lib/et/registry.ts — see lib/system-config.ts
// for the aggregator.
const PROVIDERS: Record<string, TtsProvider> = {
  azure: azureTtsProvider,
  gradium: gradiumTtsProvider,
  mistral: mistralTtsProvider,
};

/**
 * The single source of truth for which provider is live PER LANGUAGE — TTS
 * is the one capability where "live" isn't a single global pick.
 * app/api/chat/route.ts calls
 * getProvider(LIVE_TTS_PROVIDER_BY_LANG[language]) directly, so this map IS
 * the switch. en/fr moved from Mistral (Voxtral) to Gradium after Voxtral's
 * latency spikes (see lib/tts/providers/gradium.ts); mistral stays
 * registered so switching back is a one-line change here. The other four
 * languages stay on Azure — Gradium covers de/es but not nl-BE/it.
 * DEV-PLAN.md Track M has the follow-up to close this gap.
 */
export const LIVE_TTS_PROVIDER_BY_LANG: Record<ConvLang, string> = {
  en: "gradium",
  fr: "gradium",
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
