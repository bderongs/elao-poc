/**
 * Direct pronunciation assessment via Mistral Voxtral (audio-input model) —
 * deliberately the SIMPLE counterpart to azure-ensemble.ts. Where the
 * ensemble provider triangulates two independent ASR engines plus an
 * LLM judge reading text evidence, this provider sends the raw audio to one
 * multimodal model and asks it to both transcribe AND judge in a single call.
 * Point of the comparison: is the complicated pipeline actually earning its
 * keep, or does "just ask a model that can hear" get close enough?
 *
 * Unlike azure-ensemble, this provider does NOT force-align to a pre-existing
 * live transcript — Voxtral produces its own transcript from the audio, and
 * the per-word verdicts follow that transcript's word order.
 *
 * MISTRAL_API_KEY never leaves the server.
 */

import { mistralComplete, mistralVoxtralModel } from "@/lib/mistral";
import { assessProcessLabel } from "@/lib/turn-labels";
import { logServerEvent } from "@/lib/server-log";
import type { PronunciationProvider, PronunciationAssessParams } from "@/lib/pronunciation/types";
import type { PronunciationResult } from "@/lib/pronunciation/types";

const SYSTEM_PROMPT = `You are an expert phonetician assessing the spoken pronunciation of a second-language learner. You are given the learner's audio recording directly as input — listen to it yourself and judge pronunciation the way an experienced human examiner listening in the room would. You are not given any transcript or other engine's output; your own hearing of the audio is the only evidence.

First, transcribe exactly what the learner said (verbatim — include disfluencies like "euh"/"um" only if they'd affect scoring, otherwise a clean verbatim transcript of the words spoken).

Then, FIRST judge the whole turn for a NATIVE / NEAR-NATIVE profile, because that changes how you read everything else. Signs of a native or near-native speaker: fluent connected speech, natural rhythm and intonation, no groping for words acoustically. When this profile holds:
- Default EVERY word to "good" unless there is a genuine, clearly audible mispronunciation. Native connected speech (vowel reduction, dropped final consonants, linking, contractions) is NOT a pronunciation fault.
- Score the turn 90-100. A fluent native-like speaker must land at the top of the range.

Otherwise (clearly non-native), reason word by word based on what you actually hear:
- Crisp, correct articulation → "good".
- Understandable but with a real, audible non-native accent (vowel/consonant quality off, but the word is unambiguous) → "ok". This is the honest, most common verdict for L2 learners — use it freely, don't be shy about it.
- Understood only with effort, strong distracting accent, or a phoneme clearly wrong → "off".
- Mispronounced badly enough that you had to guess the intended word from context, or it's unintelligible → "bad".
- Grammar and word-choice mistakes are NOT pronunciation mistakes. Score only HOW words were pronounced, not whether they were the "right" words to say.

Calibration for turn_score — use the FULL range, do not cluster everyone in the middle, and do NOT default to the same number for every turn — vary it with how strong the accent actually is, even between two turns you'd word-score identically:
- Native / near-native fluent speech: 90-100.
- Clear but accented (mostly "ok"): 72-89. This is the honest, most common profile for a competent L2 learner. Spread within this range by ACCENT STRENGTH, not just intelligibility: a light, barely-there accent that rarely draws attention belongs near 85-89; a persistent, easily-noticeable accent throughout — even if every word was still individually clear enough to call "good" — belongs near 72-78. Marking most words "good" does NOT by itself mean the turn belongs in the native band above, or at the top of this one: word verdicts capture whether each word was UNDERSTOOD, turn_score must separately capture how NATIVE-LIKE the accent sounded overall.
- Noticeable non-native accent throughout (several "off"): 55-71.
- Accent plus words that were hard to understand: one such word caps the turn at 65; two at 50; three or more at 38; mostly unintelligible below 28.

Return ONLY JSON, no markdown fences, no commentary outside the JSON:
{"transcript": "<verbatim transcript>", "turn_score": <0-100 integer>, "words": [{"w": "<word, matching the transcript above, in order>", "v": "good|ok|off|bad"}], "summary": "<one short sentence on the main issue, or empty if none>"}`;

// Deliberately more generous than azure-ensemble.ts's otherwise-identical-looking
// map (mainly the "ok" bucket): Voxtral is a single-call, ear-only judge with
// no second engine or acoustic score to lean on, and empirically scored 5-10
// points below Speechace on the same recordings azure-ensemble scored 10-30
// points above. This shift is a calibration fix for that gap, not a claim
// that these numbers are independently "more correct" than Speechace's.
//
// Re-checked for M8 Track M (2026-08-10), now that this is the live/headline
// score rather than a secondary comparison row: left unchanged. The client's
// own review of real sessions — the thing that triggered switching the
// default to Voxtral in the first place — was already looking at scores
// produced by this exact map, so it's validated by that feedback, not just
// by the original Speechace-comparison exercise. Revisit with fresh
// Speechace-vs-Voxtral recordings if the client flags scores as off now that
// they're the number shown by default (M-05 sibling task).
const VERDICT_MAP: Record<string, { confidence: number; accuracyScore: number; errorType: string }> = {
  good: { confidence: 1.0, accuracyScore: 96, errorType: "None" },
  ok: { confidence: 0.75, accuracyScore: 82, errorType: "None" },
  off: { confidence: 0.5, accuracyScore: 48, errorType: "Mispronunciation" },
  bad: { confidence: 0.2, accuracyScore: 16, errorType: "Mispronunciation" },
};

const LANG_LABELS: Record<string, string> = {
  fr: "French", "nl-BE": "Dutch (Belgian)", es: "Spanish", it: "Italian", de: "German", en: "English",
};

interface VoxtralJudgeWord {
  w: string;
  v: "good" | "ok" | "off" | "bad";
}

interface VoxtralJudgeResult {
  transcript: string;
  turn_score: number;
  words: VoxtralJudgeWord[];
  summary?: string;
}

/** Voxtral's documented audio formats are wav/mp3/m4a/flac/ogg; best-effort map from our recorder's content-types. */
function audioFormat(contentType: string): string {
  const ct = contentType.toLowerCase();
  if (ct.includes("wav")) return "wav";
  if (ct.includes("mp4") || ct.includes("m4a")) return "m4a";
  if (ct.includes("ogg")) return "ogg";
  if (ct.includes("mp3") || ct.includes("mpeg")) return "mp3";
  // webm/opus isn't in Voxtral's documented format list — pass through and
  // let the API reject it explicitly rather than silently mis-decoding.
  if (ct.includes("webm")) return "webm";
  return "wav";
}

async function assess({
  audio,
  contentType,
  langCode,
  context = "",
  clientWpm = 0,
  turnLogId,
}: PronunciationAssessParams): Promise<PronunciationResult | null> {
  if (!process.env.MISTRAL_API_KEY) throw new Error("MISTRAL_API_KEY missing");

  // "EO" = Evaluation Oral — see lib/turn-labels.ts. Falls back to the old
  // unlabeled context string when called without a turnLogId (e.g. the admin
  // pronunciation lab's replay path, outside the live H-01 timeline).
  const processLabel = turnLogId ? assessProcessLabel("EO", turnLogId) : "voxtral-judge";
  logServerEvent("eo_request_received", { turnLogId, process: processLabel });

  const langLabel = LANG_LABELS[langCode] ?? "English";
  const format = audioFormat(contentType);
  const base64Audio = Buffer.from(audio).toString("base64");

  const userText =
    `Language the learner is speaking: ${langLabel}.\n` +
    (context ? `The examiner's question they were answering: "${context}"\n` : "") +
    `Listen to the attached audio and assess the pronunciation as instructed.`;

  let parsed: VoxtralJudgeResult;
  try {
    const raw = await mistralComplete({
      model: mistralVoxtralModel(),
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            { type: "input_audio", input_audio: { data: base64Audio, format } },
            { type: "text", text: userText },
          ],
        },
      ],
      maxTokens: 2000,
      json: true,
      context: processLabel,
    });
    const cleaned = raw.trim().replace(/^```json\s*|\s*```$/g, "").trim();
    parsed = JSON.parse(cleaned) as VoxtralJudgeResult;
    if (typeof parsed.turn_score !== "number" || !Array.isArray(parsed.words) || typeof parsed.transcript !== "string") {
      throw new Error("malformed Voxtral judge response");
    }
  } catch (e) {
    console.error("[pronunciation] voxtral failed:", e);
    logServerEvent("eo_failed", { turnLogId, process: processLabel, error: String(e) });
    throw e instanceof Error ? e : new Error(String(e));
  }

  const words = parsed.words.map((w) => {
    const m = VERDICT_MAP[w.v] ?? VERDICT_MAP.ok;
    return { word: w.w, confidence: m.confidence, accuracyScore: m.accuracyScore, errorType: m.errorType };
  });

  // Consistency guard, with slack: the turn score can exceed the strict
  // average of per-word verdicts by a small margin, so the judge's holistic
  // turn_score (which can fairly weigh a majority of "good" words higher
  // than a literal average would) isn't mechanically capped down to the
  // "ok" bucket value on every turn with a healthy mix — while still
  // catching a turn_score wildly out of step with the verdicts it just gave.
  const wordAvg = words.length
    ? Math.round(words.reduce((s, w) => s + w.accuracyScore, 0) / words.length)
    : 0;
  const score = Math.max(0, Math.min(100, Math.round(parsed.turn_score), wordAvg + 8));

  console.log(
    `[pronunciation] voxtral OK score=${score} verdicts=${parsed.words.map((w) => `${w.w}:${w.v}`).join(" ")}${parsed.summary ? ` — ${parsed.summary}` : ""}`
  );
  logServerEvent("eo_complete", { turnLogId, process: processLabel, provider: "voxtral", model: mistralVoxtralModel(), score });

  return {
    text: parsed.transcript,
    pronunciationScore: score,
    accuracyScore: score,
    // No independent duration signal in a single-call setup — fall back to
    // the client-measured estimate only (0 when unavailable, e.g. lab replay).
    wpm: clientWpm,
    words,
    source: "voxtral",
  };
}

export const voxtralProvider: PronunciationProvider = {
  id: "voxtral",
  label: "Voxtral (direct audio, single call) — default",
  modelLabel: mistralVoxtralModel(),
  assess,
};
