/**
 * Gradium TTS — the live voice for English/French/Spanish/German, replacing Mistral
 * (Voxtral) after its first-sentence latency spiked to 5–14s on some turns
 * (logs/server-2026-09-21.log, 12:23 session). Gradium is Paris-based and
 * the requests go to its EU endpoint (eu.api.gradium.ai), which pins
 * processing to EU servers — the response's x-gradium-residency header
 * reports whether that pin is active ("pinned; zone=eu") or not yet enabled
 * on the account ("best-effort; zone=eu"); it's logged below.
 *
 * Gradium also covers de/es, which are live on it too. nl-BE/it aren't
 * supported — those stay on Azure, see lib/tts/registry.ts's
 * LIVE_TTS_PROVIDER_BY_LANG.
 *
 * nl-NL: Gradium shared BETA Dutch voices (message from Gradium, 2026-11-19).
 * NL-NL accent only (no NL-BE yet), only on the beta model — the default
 * model doesn't speak Dutch — not in the voice library yet, and quality and
 * IDs may still change before release. Gradium advised test-only; Baptiste
 * chose to put it live in prod anyway (2026-11-19), with Lieke by default,
 * GRADIUM_NL_BETA_VOICE to switch voice or turn it off, and an Azure fallback
 * in the chat route if a beta call fails (see gradiumNlBetaVoice below).
 */

import { logServerEvent } from "@/lib/server-log";
import { chatProcessLabel } from "@/lib/turn-labels";
import type { ConvLang } from "@/lib/conversation-prompts";
import type { TtsProvider, TtsSynthesizeParams } from "@/lib/tts/types";

const GRADIUM_TTS_URL = "https://eu.api.gradium.ai/api/post/speech/tts";
const GRADIUM_TTS_MODEL = "default";
const GRADIUM_TTS_BETA_MODEL = "gradium-tts-beta-202611";

type GradiumVoice = { id: string; name: string; model?: string };

// Female flagship voices, for gender continuity with the avatar (see
// https://docs.gradium.ai/guides/voices/flagship-voices). Unlike Mistral,
// Gradium has US-accented female English voices, so English goes back to a
// US accent (matching Azure's en-US-AvaNeural).
//   en: Zoey — "Playful, upbeat and Gen Z energy voice with a standard American accent."
//   fr: Solène — "A young French voice, bright and high-pitched, warm and enthusiastic at a lively pace."
const GRADIUM_VOICE: Partial<Record<ConvLang, GradiumVoice>> = {
  en: { id: "NbpkqMVS3CJeq2j8", name: "Zoey" },
  fr: { id: "YhIHaAfQ0cQPDV9R", name: "Solène" },
  //   de: Resi — "Warm, grounded Bavarian woman's voice with a measured, trustworthy delivery."
  //   es: Vera — "A sweet, expressive young Castilian Spanish voice, soft and girly with excited emphasis."
  de: { id: "MAYVpVTYBzLRqNC7", name: "Resi" },
  es: { id: "iTQW2xFICXk8riV4", name: "Vera" },
};

/** Beta NL-NL voices (Gradium, 2026-11-19). Lieke/Noor are female — they match the avatar; Jeroen/Maarten are male, for comparison only. */
const GRADIUM_NL_BETA_VOICES: Record<string, GradiumVoice> = {
  lieke: { id: "XopA6WXcSc3GnEmV", name: "Lieke", model: GRADIUM_TTS_BETA_MODEL },
  noor: { id: "ew5JGK0kuxHoZzK4", name: "Noor", model: GRADIUM_TTS_BETA_MODEL },
  jeroen: { id: "Qsl1SUZR5faLSEuT", name: "Jeroen", model: GRADIUM_TTS_BETA_MODEL },
  maarten: { id: "bdMubAaVnuVJ9YoF", name: "Maarten", model: GRADIUM_TTS_BETA_MODEL },
};

const DEFAULT_NL_BETA_VOICE = "lieke";

/**
 * The beta Dutch voice for nl-NL: Lieke by default, or the one named by
 * GRADIUM_NL_BETA_VOICE (lieke | noor | jeroen | maarten, case-insensitive).
 * GRADIUM_NL_BETA_VOICE=off returns null — nl-NL then goes back to Azure
 * (lib/tts/registry.ts's liveTtsProviderId), e.g. if Gradium changes the
 * beta IDs. An unknown name falls back to the default voice. Read at call
 * time so a .env change only needs a server restart.
 */
export function gradiumNlBetaVoice(): GradiumVoice | null {
  const pick = process.env.GRADIUM_NL_BETA_VOICE?.trim().toLowerCase() || DEFAULT_NL_BETA_VOICE;
  if (pick === "off") return null;
  const voice = GRADIUM_NL_BETA_VOICES[pick];
  if (!voice) console.warn(`GRADIUM_NL_BETA_VOICE="${pick}" is not one of ${Object.keys(GRADIUM_NL_BETA_VOICES).join(", ")}, off — using ${DEFAULT_NL_BETA_VOICE}`);
  return voice ?? GRADIUM_NL_BETA_VOICES[DEFAULT_NL_BETA_VOICE];
}

function voiceFor(language: ConvLang): GradiumVoice | null {
  if (language === "nl-NL") return gradiumNlBetaVoice();
  return GRADIUM_VOICE[language] ?? null;
}

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
  const voice = voiceFor(language);
  const model = voice?.model ?? GRADIUM_TTS_MODEL;
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
          model_name: model,
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
        turnLogId, process: processLabel, provider: "gradium", model, language,
        status: res.status, durationMs, attempt, body: body.slice(0, 300),
      });
      return null;
    }
    logServerEvent("tts_request_success", {
      turnLogId, process: processLabel, provider: "gradium", model, language, voice: voice.name, durationMs, attempt,
      residency: res.headers.get("x-gradium-residency"),
    });

    return releaseOnEnd(res.body, release);
  }
}

export const gradiumTtsProvider: TtsProvider = {
  id: "gradium",
  label: "Gradium TTS (EU)",
  modelLabel: `gradium-tts (${GRADIUM_TTS_MODEL})`,
  voiceLabel: (language) => {
    const voice = voiceFor(language);
    if (!voice) return "(unsupported — falls back to Azure)";
    return voice.model ? `${voice.name} (BETA model ${voice.model})` : voice.name;
  },
  synthesize,
};
