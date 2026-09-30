/**
 * Gradium TTS — the live voice for English/French, replacing Mistral
 * (Voxtral) after its first-sentence latency spiked to 5–14s on some turns
 * (logs/server-2026-09-21.log, 12:23 session). Gradium is Paris-based and
 * the requests go to its EU endpoint (eu.api.gradium.ai), which pins
 * processing to EU servers — the response's x-gradium-residency header
 * reports whether that pin is active ("pinned; zone=eu") or not yet enabled
 * on the account ("best-effort; zone=eu"); it's logged below.
 *
 * Gradium also covers de/es (not nl-BE/it) — those stay on Azure for now,
 * see lib/tts/registry.ts's LIVE_TTS_PROVIDER_BY_LANG.
 */

import { logServerEvent } from "@/lib/server-log";
import { chatProcessLabel } from "@/lib/turn-labels";
import type { ConvLang } from "@/lib/conversation-prompts";
import type { TtsProvider, TtsSynthesizeParams } from "@/lib/tts/types";

const GRADIUM_TTS_URL = "https://eu.api.gradium.ai/api/post/speech/tts";
const GRADIUM_TTS_MODEL = "default";

// Female flagship voices, for gender continuity with the avatar (see
// https://docs.gradium.ai/guides/voices/flagship-voices). Unlike Mistral,
// Gradium has US-accented female English voices, so English goes back to a
// US accent (matching Azure's en-US-AvaNeural).
//   en: Harper — "Modern, confident and friendly voice with a standard American accent."
//   fr: Apolline — "A sparky, attentive French adult voice that gets to the point with a smile."
const GRADIUM_VOICE: Partial<Record<ConvLang, { id: string; name: string }>> = {
  en: { id: "4SZHfMpw-p46Ywgs", name: "Harper" },
  fr: { id: "6oIkS98REoVZ1dEw", name: "Apolline" },
};

/**
 * Gradium caps the account at 2 concurrent TTS sessions — a 3rd parallel
 * request gets 400 "Concurrency limit exceeded: 2 active sessions". The chat
 * route fires every sentence the moment it's complete, so a 4-sentence intro
 * lost its last 2 sentences (the opening question) and the avatar just
 * stopped (logs/server-2026-09-30.log, 08:18 session). Measured 2026-09-30:
 * an open STT socket (lib/realtime-stt-gradium.ts) does NOT take a slot.
 *
 * So requests queue FIFO for one of MAX_CONCURRENT slots, held until the
 * audio body is fully read. FIFO keeps this deadlock-free with the chat
 * route's in-order drain: a sentence only ever waits on earlier sentences,
 * which the drain consumes first. Per-process only — other instances or
 * other users of the key can still hit the limit, hence the retry below.
 */
const MAX_CONCURRENT = 2;
/** Frees a slot even if a reader is abandoned mid-drain (client gone, route threw) — a leaked slot would otherwise stall every later request. */
const SLOT_TIMEOUT_MS = 30_000;
const CONCURRENCY_RETRIES = 3;
const CONCURRENCY_RETRY_DELAY_MS = 400;

let activeSlots = 0;
const slotWaiters: (() => void)[] = [];

/** Resolves with a release function once a slot is free. Must be called synchronously at request time so queue order = sentence order. */
function acquireSlot(): Promise<() => void> {
  const grant = (): (() => void) => {
    activeSlots++;
    let released = false;
    const timer = setTimeout(() => release(), SLOT_TIMEOUT_MS);
    const release = () => {
      if (released) return;
      released = true;
      clearTimeout(timer);
      activeSlots--;
      slotWaiters.shift()?.();
    };
    return release;
  };
  if (activeSlots < MAX_CONCURRENT) return Promise.resolve(grant());
  return new Promise((resolve) => slotWaiters.push(() => resolve(grant())));
}

/** Passes the body through unchanged, releasing the slot when it ends, errors or is cancelled. */
function releaseOnEnd(body: ReadableStream<Uint8Array>, release: () => void): ReadableStreamDefaultReader<Uint8Array> {
  const src = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await src.read();
        if (done) {
          release();
          controller.close();
        } else {
          controller.enqueue(value);
        }
      } catch (e) {
        release();
        controller.error(e);
      }
    },
    cancel(reason) {
      release();
      return src.cancel(reason);
    },
  }).getReader();
}

/**
 * Starts a Gradium TTS request and returns a reader yielding raw PCM bytes —
 * same contract as azure.ts's reader. Requests "pcm_24000" explicitly: the
 * plain "pcm" format is 48kHz, and lib/audio-player.ts's StreamingAudioPlayer
 * hardcodes 24000Hz playback. `only_audio: true` makes the body the raw
 * audio itself rather than a stream of JSON messages, so it's passed through
 * as-is.
 *
 * NOTE: `rate` (CEFR-level pacing) is accepted for interface parity but
 * ignored, same as mistral.ts. Gradium's speed control (json_config
 * `padding_bonus`, -4.0 to 4.0) isn't calibrated against Azure's SSML
 * percentages yet.
 */
async function synthesize({ text, language, turnLogId }: TtsSynthesizeParams): Promise<ReadableStreamDefaultReader<Uint8Array> | null> {
  const key = process.env.GRADIUM_API;
  const voice = GRADIUM_VOICE[language];
  const processLabel = turnLogId ? chatProcessLabel(turnLogId) : undefined;
  if (!key || !voice || !text.trim()) return null;

  const release = await acquireSlot();
  const startedAt = Date.now();
  for (let attempt = 1; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(GRADIUM_TTS_URL, {
        method: "POST",
        headers: {
          "x-api-key": key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          voice_id: voice.id,
          output_format: "pcm_24000",
          model_name: GRADIUM_TTS_MODEL,
          only_audio: true,
        }),
      });
    } catch (e) {
      release();
      throw e;
    }
    const durationMs = Date.now() - startedAt;

    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => "");
      const concurrencyLimited = res.status === 400 && /concurrency limit/i.test(body);
      if (concurrencyLimited && attempt <= CONCURRENCY_RETRIES) {
        logServerEvent("tts_request_retry", { turnLogId, process: processLabel, provider: "gradium", language, attempt, reason: "concurrency_limit" });
        await new Promise((r) => setTimeout(r, CONCURRENCY_RETRY_DELAY_MS * attempt));
        continue;
      }
      release();
      console.error("Gradium TTS error:", res.status, body);
      logServerEvent("tts_request_error", {
        turnLogId, process: processLabel, provider: "gradium", model: GRADIUM_TTS_MODEL, language,
        status: res.status, durationMs, attempt, body: body.slice(0, 300),
      });
      return null;
    }
    logServerEvent("tts_request_success", {
      turnLogId, process: processLabel, provider: "gradium", model: GRADIUM_TTS_MODEL, language, durationMs, attempt,
      residency: res.headers.get("x-gradium-residency"),
    });

    return releaseOnEnd(res.body, release);
  }
}

export const gradiumTtsProvider: TtsProvider = {
  id: "gradium",
  label: "Gradium TTS (EU)",
  modelLabel: `gradium-tts (${GRADIUM_TTS_MODEL})`,
  voiceLabel: (language) => GRADIUM_VOICE[language]?.name ?? "(unsupported — falls back to Azure)",
  synthesize,
};
