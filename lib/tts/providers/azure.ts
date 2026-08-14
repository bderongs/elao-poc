/**
 * Azure Neural TTS — the live voice for 4 of 6 languages (Dutch-BE, Spanish,
 * Italian, German); English/French use lib/tts/providers/mistral.ts instead
 * (see lib/tts/registry.ts's LIVE_TTS_PROVIDER_BY_LANG). Moved here as-is
 * from app/api/chat/route.ts — no behavior change, just relocated behind the
 * TTS provider registry.
 */

import { logServerEvent } from "@/lib/server-log";
import { chatProcessLabel } from "@/lib/turn-labels";
import type { ConvLang } from "@/lib/conversation-prompts";
import type { TtsProvider, TtsSynthesizeParams } from "@/lib/tts/types";

/**
 * Per-language voice profile.
 *   voice — a natural multilingual / regional neural voice (English was
 *           previously voiced by the FRENCH Vivienne voice — fixed).
 *   style — Azure mstts:express-as conversational style for warmth and
 *           expressiveness; empty when the voice doesn't support styles
 *           (multilingual voices ignore unsupported styles, but we only set
 *           one where it genuinely lands).
 */
const VOICE_PROFILE: Record<ConvLang, { lang: string; voice: string; style: string }> = {
  // en-US-AvaNeural: very natural AND documented to support express-as styles
  // (the Multilingual variant is natural but has no styles — an unsupported
  // style would fail the request and silence the avatar).
  en: { lang: "en-US", voice: "en-US-AvaNeural", style: "chat" },
  fr: { lang: "fr-FR", voice: "fr-FR-VivienneMultilingualNeural", style: "" },
  // nl-BE-DenaNeural has no documented express-as styles — leave style empty so
  // the SSML can't be rejected; it still gets the livelier prosody below.
  "nl-BE": { lang: "nl-BE", voice: "nl-BE-DenaNeural", style: "" },
  // Natural regional neural voices; style left empty to avoid SSML rejection on
  // voices without documented express-as support.
  es: { lang: "es-ES", voice: "es-ES-ElviraNeural", style: "" },
  it: { lang: "it-IT", voice: "it-IT-ElsaNeural", style: "" },
  de: { lang: "de-DE", voice: "de-DE-KatjaNeural", style: "" },
};

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Build expressive SSML.
 * - mstts:express-as style="chat" + styledegree gives a warm, conversational
 *   register instead of the flat reading voice.
 * - prosody rate is caller-supplied (slow for A1/A2 listeners, natural for B1+)
 *   with a slight pitch lift for gentle intonation movement.
 */
function buildSSML(text: string, p: { lang: string; voice: string; style: string }, rate: string): string {
  const inner = `<prosody rate="${rate}" pitch="+3%">${escapeXml(text)}</prosody>`;
  const styled = p.style
    ? `<mstts:express-as style="${p.style}" styledegree="1.3">${inner}</mstts:express-as>`
    : inner;
  return (
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" ` +
    `xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${p.lang}">` +
    `<voice name="${p.voice}">${styled}</voice></speak>`
  );
}

/**
 * Starts an Azure TTS request immediately and returns a reader for the PCM stream.
 * Calling this function (without await) fires the HTTP request right away so it
 * runs in parallel with LLM generation.
 */
async function synthesize({ text, language, rate, turnLogId }: TtsSynthesizeParams): Promise<ReadableStreamDefaultReader<Uint8Array> | null> {
  const key = process.env.AZURE_SPEECH_KEY;
  if (!key || !text.trim()) return null;

  const region = process.env.AZURE_SPEECH_REGION ?? "westeurope";
  const profile = VOICE_PROFILE[language] ?? VOICE_PROFILE.en;
  const processLabel = turnLogId ? chatProcessLabel(turnLogId) : undefined;

  const res = await fetch(
    `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`,
    {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": key,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "raw-24khz-16bit-mono-pcm",
      },
      body: buildSSML(text, profile, rate),
    }
  );

  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    console.error("Azure TTS error:", res.status, body);
    logServerEvent("tts_request_error", { turnLogId, process: processLabel, provider: "azure", model: profile.voice, language, status: res.status });
    return null;
  }

  logServerEvent("tts_request_success", { turnLogId, process: processLabel, provider: "azure", model: profile.voice, language });
  return res.body.getReader();
}

export const azureTtsProvider: TtsProvider = {
  id: "azure",
  label: "Azure Neural TTS",
  modelLabel: "Azure Neural TTS (per-language voice — see per-language breakdown)",
  voiceLabel: (language) => (VOICE_PROFILE[language] ?? VOICE_PROFILE.en).voice,
  synthesize,
};
