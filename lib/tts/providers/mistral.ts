/**
 * Mistral (Voxtral) TTS — the live voice for English/French, the only two
 * languages with a preset voice on this account today (confirmed live
 * against the real /v1/audio/voices endpoint — nothing for nl-BE/es/it/de,
 * see lib/tts/providers/azure.ts for those). Moved here as-is from
 * app/api/chat/route.ts — no behavior change, just relocated behind the TTS
 * provider registry. See DEV-PLAN.md Track M for the follow-up migration
 * task (Gradium or self-hosted Kyutai) to close the gap for all 6 languages
 * under one provider.
 */

import { logServerEvent } from "@/lib/server-log";
import { chatProcessLabel } from "@/lib/turn-labels";
import type { ConvLang } from "@/lib/conversation-prompts";
import type { TtsProvider, TtsSynthesizeParams } from "@/lib/tts/types";

const MISTRAL_TTS_MODEL = "voxtral-mini-tts-2603";

// Picked for gender continuity with the avatar (female): Mistral has no
// en_us female preset (Paul is the only en_us voice), so gb_jane_neutral is
// used instead, trading the US accent for a British one rather than shipping
// a male voice on a female avatar. "Léa" (fr persona,
// lib/conversation-prompts.ts) is female, so fr_marie_neutral matches
// directly.
const MISTRAL_VOICE_SLUG: Partial<Record<ConvLang, string>> = {
  en: "gb_jane_neutral",
  fr: "fr_marie_neutral",
};

// The streaming "wav" response's fixed RIFF/WAVE/fmt/data header — verified
// live (2026-08-11) at exactly 44 bytes, with the RIFF and data chunk sizes
// set to the 0xFFFFFFFF streaming placeholder. Only ever present on the
// FIRST delta chunk of a stream.
const MISTRAL_WAV_HEADER_BYTES = 44;

/**
 * Starts a Mistral (Voxtral) TTS request via its streaming SSE endpoint and
 * returns a reader yielding raw PCM bytes — same contract as azure.ts's
 * reader (lib/audio-player.ts's StreamingAudioPlayer hardcodes 24000Hz
 * playback), so the rest of the pipeline doesn't need to know which
 * provider produced the audio.
 *
 * Requests response_format "wav" rather than "pcm", deliberately: verified
 * live (2026-08-11, 3x repeated calls on identical short input, near-zero
 * variance) that this endpoint's raw "pcm" format is actually 48kHz — double
 * the byte count of "wav" for the same audio — despite the model card
 * claiming "24 kHz audio output" for every format. "wav" IS reliably 24kHz
 * (matches Azure exactly), so it's used here with its fixed 44-byte header
 * stripped from the first chunk only, rather than risk shipping a silent
 * half-speed/wrong-pitch playback bug.
 *
 * NOTE: no rate/speed control today — confirmed live that a top-level
 * `speed` field and `json_config: { speed }` are both rejected (422 "Extra
 * inputs are not permitted") on this model. So `rate` (CEFR-level pacing) is
 * accepted for interface parity but silently ignored — only azure.ts's
 * provider actually applies it.
 */
async function synthesize({ text, language, turnLogId }: TtsSynthesizeParams): Promise<ReadableStreamDefaultReader<Uint8Array> | null> {
  const key = process.env.MISTRAL_API_KEY;
  const voiceId = MISTRAL_VOICE_SLUG[language];
  const processLabel = turnLogId ? chatProcessLabel(turnLogId) : undefined;
  if (!key || !voiceId || !text.trim()) return null;

  const res = await fetch("https://api.mistral.ai/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      model: MISTRAL_TTS_MODEL,
      input: text,
      voice_id: voiceId,
      response_format: "wav",
      stream: true,
    }),
  });

  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    console.error("Mistral TTS error:", res.status, body);
    logServerEvent("tts_request_error", { turnLogId, process: processLabel, provider: "mistral", model: MISTRAL_TTS_MODEL, language, status: res.status });
    return null;
  }
  logServerEvent("tts_request_success", { turnLogId, process: processLabel, provider: "mistral", model: MISTRAL_TTS_MODEL, language });

  // Decode the SSE stream (event: speech.audio.delta / data: {"audio_data": base64})
  // into a plain byte stream, stripping the leading WAV header once, so the
  // caller can treat it exactly like Azure's raw PCM response body.
  const sseReader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  // Counts down as header bytes are consumed, rather than a one-shot flag on
  // the first chunk — the SSE stream can (and does, occasionally) split the
  // 44-byte header across more than one `audio_data` delta, and stripping a
  // fixed 44 bytes only from chunk #1 leaves the remainder of the header
  // spliced into the PCM stream as if it were audio, which came through as a
  // burst of noise/garbled audio before the real speech.
  let headerBytesRemaining = MISTRAL_WAV_HEADER_BYTES;

  const pcmStream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      while (true) {
        const sep = buffer.indexOf("\n\n");
        if (sep !== -1) {
          const block = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          const dataLine = block.split("\n").find((l) => l.startsWith("data:"));
          if (dataLine) {
            try {
              const evt = JSON.parse(dataLine.slice(5).trim());
              if (typeof evt.audio_data === "string") {
                let chunk = Buffer.from(evt.audio_data, "base64");
                if (headerBytesRemaining > 0) {
                  const strip = Math.min(headerBytesRemaining, chunk.length);
                  chunk = chunk.subarray(strip);
                  headerBytesRemaining -= strip;
                }
                if (chunk.length) {
                  controller.enqueue(chunk);
                  return;
                }
              }
            } catch {
              // Malformed or non-audio SSE line (e.g. a trailing status event) — skip it.
            }
          }
          continue;
        }
        const { value, done } = await sseReader.read();
        if (done) {
          controller.close();
          return;
        }
        buffer += decoder.decode(value, { stream: true });
      }
    },
  });

  return pcmStream.getReader();
}

export const mistralTtsProvider: TtsProvider = {
  id: "mistral",
  label: "Mistral (Voxtral speech)",
  modelLabel: MISTRAL_TTS_MODEL,
  voiceLabel: (language) => MISTRAL_VOICE_SLUG[language] ?? "(unsupported — falls back to Azure)",
  synthesize,
};
