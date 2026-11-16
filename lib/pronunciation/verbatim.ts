/**
 * The pronunciation judges' second, independent hearing of a turn (the
 * "VERBATIM transcript"): an engine other than the live recognizer, as close
 * as possible to what was acoustically said, so a mispronounced word shows
 * up as a different word. Used by azure-ensemble (live) and azure-intended.
 *
 * Roadmap phase 4: Deepgram goes away. Three engines are wired, picked by
 * PRONUNCIATION_VERBATIM_ENGINE (default below):
 *   - "voxtral-transcribe" — Mistral's transcription endpoint. LIVE since
 *     2026-11-16: the A-02 replay on stored audio (66 turns, 6 languages)
 *     scored within the judge's own run-to-run noise of Deepgram, so the
 *     level floors were left alone (doc/roadmap-2026-11-plan.md, A-02).
 *     A cleaned-up transcript and no per-word confidence.
 *   - "deepgram"          — nova-3, per-word confidence. Live until
 *     2026-11-16; kept for rollback only (needs DEEPGRAM_API_KEY).
 *   - "voxtral-chat"      — Voxtral (audio chat model) told to write exactly
 *     what it hears, errors and non-words included. No confidence either.
 * Engines without confidence leave it out; the judge prompts say what to do then.
 *
 * Every engine returns null on failure: the judges then run without this
 * hearing (worst case = Azure alone, as before).
 */
import { mistralComplete, mistralTranscribe, mistralVoxtralModel } from "@/lib/mistral";

export const VERBATIM_ENGINES = ["deepgram", "voxtral-transcribe", "voxtral-chat"] as const;
export type VerbatimEngine = (typeof VERBATIM_ENGINES)[number];

const isVerbatimEngine = (v: unknown): v is VerbatimEngine => (VERBATIM_ENGINES as readonly unknown[]).includes(v);

/** The live engine: Voxtral transcription unless the env var says otherwise (rollback). */
export const LIVE_VERBATIM_ENGINE: VerbatimEngine = isVerbatimEngine(process.env.PRONUNCIATION_VERBATIM_ENGINE)
  ? process.env.PRONUNCIATION_VERBATIM_ENGINE
  : "voxtral-transcribe";

export interface VerbatimEvidence {
  engine: VerbatimEngine;
  transcript: string;
  /** Per-word confidence 0-1 — only from engines that give it (Deepgram). */
  words: Array<{ word: string; confidence?: number }>;
}

/** Mistral/Deepgram language codes from a test language. */
function baseLang(langCode: string): string {
  return langCode.split("-")[0] || "en";
}

const LANG_NAME: Record<string, string> = { fr: "French", en: "English", nl: "Dutch", es: "Spanish", it: "Italian", de: "German" };

/** Rollback only (PRONUNCIATION_VERBATIM_ENGINE=deepgram) and scripts/asr-disagreement.ts. */
export async function deepgramVerbatim(audio: ArrayBuffer, contentType: string, langCode: string): Promise<VerbatimEvidence | null> {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) return null;
  const lang = baseLang(langCode) === "en" ? "en-US" : baseLang(langCode);
  try {
    const res = await fetch(`https://api.deepgram.com/v1/listen?model=nova-3&language=${lang}&punctuate=false&smart_format=false`, {
      method: "POST",
      headers: { Authorization: `Token ${key}`, "Content-Type": contentType },
      body: audio,
    });
    if (!res.ok) {
      console.warn(`[pronunciation] deepgram ${res.status}: ${(await res.text()).slice(0, 150)}`);
      return null;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (await res.json()) as any;
    const alt = data.results?.channels?.[0]?.alternatives?.[0];
    if (!alt?.transcript?.trim()) return null;
    return {
      engine: "deepgram",
      transcript: alt.transcript as string,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      words: (alt.words ?? []).map((w: any) => ({ word: w.word as string, confidence: Math.round((w.confidence ?? 0) * 100) / 100 })),
    };
  } catch (e) {
    console.warn("[pronunciation] deepgram failed:", e);
    return null;
  }
}

const words = (text: string) => text.split(/\s+/).filter(Boolean).map((word) => ({ word }));

async function voxtralTranscribeVerbatim(audio: ArrayBuffer, contentType: string, langCode: string): Promise<VerbatimEvidence | null> {
  try {
    const { text } = await mistralTranscribe({ audio, filename: "turn.wav", contentType, language: baseLang(langCode), context: "pronunciation-verbatim" });
    return text.trim() ? { engine: "voxtral-transcribe", transcript: text.trim(), words: words(text) } : null;
  } catch (e) {
    console.warn("[pronunciation] voxtral transcribe failed:", e);
    return null;
  }
}

const CHAT_SYSTEM = `You transcribe a language learner's spoken answer for a pronunciation check. Write down exactly what is pronounced, word by word, not what the speaker meant:
- If a word is mispronounced so that it sounds like another word, write the word you hear ("sink" for a mispronounced "think").
- If it sounds like no real word, spell it as it sounds.
- Keep repetitions, false starts and grammar mistakes. Do not correct, complete or tidy anything.
- No punctuation, no comments, no translation. Return only the transcript; an empty string if nothing is said.`;

function audioFormat(contentType: string): string {
  const ct = contentType.toLowerCase();
  if (ct.includes("mp4") || ct.includes("m4a")) return "m4a";
  if (ct.includes("ogg")) return "ogg";
  if (ct.includes("mp3") || ct.includes("mpeg")) return "mp3";
  if (ct.includes("webm")) return "webm";
  return "wav";
}

async function voxtralChatVerbatim(audio: ArrayBuffer, contentType: string, langCode: string): Promise<VerbatimEvidence | null> {
  try {
    const text = await mistralComplete({
      model: mistralVoxtralModel(),
      system: CHAT_SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            { type: "input_audio", input_audio: { data: Buffer.from(audio).toString("base64"), format: audioFormat(contentType) } },
            { type: "text", text: `The speaker is speaking ${LANG_NAME[baseLang(langCode)] ?? "English"}. Transcribe exactly what you hear.` },
          ],
        },
      ],
      maxTokens: 600,
      context: "pronunciation-verbatim",
    });
    const clean = text.trim().replace(/^["“]|["”]$/g, "").trim();
    return clean ? { engine: "voxtral-chat", transcript: clean, words: words(clean) } : null;
  } catch (e) {
    console.warn("[pronunciation] voxtral chat verbatim failed:", e);
    return null;
  }
}

/** The second hearing with the live engine, or the one asked for (replays). */
export function verbatimHearing(audio: ArrayBuffer, contentType: string, langCode: string, engine: VerbatimEngine = LIVE_VERBATIM_ENGINE): Promise<VerbatimEvidence | null> {
  if (engine === "voxtral-chat") return voxtralChatVerbatim(audio, contentType, langCode);
  if (engine === "deepgram") return deepgramVerbatim(audio, contentType, langCode);
  return voxtralTranscribeVerbatim(audio, contentType, langCode);
}

/** The confidence line of the judge's evidence, or the note that this engine gives none. */
export function confidenceLine(v: VerbatimEvidence): string {
  return v.words.some((w) => w.confidence !== undefined)
    ? `Per-word confidence: ${v.words.map((w) => `${w.word}(${w.confidence})`).join(" ")}`
    : "Per-word confidence: unavailable (this engine gives none)";
}

/** Model label for admin/system-config display. */
export function verbatimEngineLabel(engine: VerbatimEngine = LIVE_VERBATIM_ENGINE): string {
  return engine === "deepgram" ? "Deepgram nova-3" : engine === "voxtral-transcribe" ? "Voxtral transcription" : `${mistralVoxtralModel()} verbatim`;
}
