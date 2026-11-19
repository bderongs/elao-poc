import type { TtsProvider } from "./types";
import type { ConvLang } from "@/lib/conversation-prompts";
import { azureTtsProvider } from "./providers/azure";
import { gradiumNlBetaVoice, gradiumTtsProvider } from "./providers/gradium";
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
 * registered so switching back is a one-line change here. de/es moved to
 * Gradium too; nl-NL moved to Gradium's BETA Dutch voices on 2026-11-19
 * (see lib/tts/providers/gradium.ts); nl-BE/it stay on Azure — Gradium
 * doesn't cover them.
 * DEV-PLAN.md Track M has the follow-up to close this gap.
 */
export const LIVE_TTS_PROVIDER_BY_LANG: Record<ConvLang, string> = {
  en: "gradium",
  fr: "gradium",
  "nl-BE": "azure",
  "nl-NL": "gradium",
  es: "gradium",
  it: "azure",
  de: "gradium",
};

/**
 * The TTS provider actually used for a language: LIVE_TTS_PROVIDER_BY_LANG,
 * except nl-NL goes back to Azure when its Gradium beta voice is switched off
 * (GRADIUM_NL_BETA_VOICE=off — see lib/tts/providers/gradium.ts).
 */
export function liveTtsProviderId(language: ConvLang): string {
  if (language === "nl-NL" && !gradiumNlBetaVoice()) return "azure";
  return LIVE_TTS_PROVIDER_BY_LANG[language];
}

/** True when `language` runs on a beta voice — the chat route then falls back to Azure if it fails, rather than skipping the sentence. */
export function isBetaTts(language: ConvLang): boolean {
  return language === "nl-NL" && liveTtsProviderId(language) === "gradium";
}

export function getProvider(id: string): TtsProvider {
  const provider = PROVIDERS[id];
  if (!provider) throw new Error(`Unknown TTS provider: ${id}`);
  return provider;
}

export function listProviders(): TtsProvider[] {
  return Object.values(PROVIDERS);
}
