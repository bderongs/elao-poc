/**
 * Experimental pronunciation assessment — Azure SCRIPTED mode against the
 * sentence the speaker INTENDED to say. Admin comparison only, never live
 * (see COMPARISON_ONLY_PRONUNCIATION_PROVIDER_IDS in lib/pronunciation-rollup.ts).
 *
 * Why: any reference taken from a recognizer's hearing of the same audio is
 * circular. If "think" is pronounced "sink" and the recognizer writes "sink",
 * Azure then grades "sink" against "sink" and finds it well pronounced — the
 * error is masked. Here the reference is the INTENDED sentence instead, so a
 * mispronounced word is graded against the word the speaker was aiming for:
 *
 *   1. Three hearings of the audio: the live transcript, Deepgram nova-3
 *      (with per-word confidence) and Azure's own free-speech recognizer.
 *   2. Mistral reconstructs the intended sentence from them plus the
 *      examiner's question. It may ONLY undo sound-alike substitutions —
 *      never fix grammar or word choice, or Azure would flag grammar errors
 *      as mispronunciations.
 *   3. Azure pronunciation assessment, scripted, with that sentence as the
 *      reference, miscue detection on and the Comprehensive dimension (the
 *      default Basic dimension returns no ErrorType per word).
 *
 * Score = mean accuracy over the reference words Azure matched in the audio.
 * Omissions (reference word not heard) are shown but excluded from the score:
 * they mostly reflect reconstruction mismatch or reduced native function
 * words, not pronunciation. Insertions (fillers, repeats) are dropped.
 * Raw Azure scale — not calibrated against Speechace like the other two.
 */

import { mistralComplete, mistralPronunciationModel } from "@/lib/mistral";
import { discreteWordConfidence } from "@/lib/pronunciation-scoring";
import { azureAcoustic, deepgramVerbatim, LANG_LABELS, type DgEvidence } from "@/lib/pronunciation/providers/azure-ensemble";
import type { PronunciationProvider, PronunciationAssessParams, PronunciationResult } from "@/lib/pronunciation/types";

const RECONSTRUCT_SYSTEM = `You reconstruct the sentence a second-language learner INTENDED to say, so that a pronunciation model can compare their audio against it.

You receive up to three independent speech-recognition transcripts of the same recording (one with per-word confidence 0-1) and the examiner's question.

Your ONLY job is to undo substitutions caused by PRONUNCIATION: places where a recognizer wrote a different, similar-sounding word because the learner mispronounced the word they meant ("sink" for "think", "ship" for "sheep", "Burton" for "important"). Where the transcripts disagree, pick the reading that makes sense in context. When they all agree on a word that makes no sense but a similar-sounding word clearly does, use that word.

STRICT RULES — the learner's own language must be preserved exactly:
- NEVER correct grammar, agreement, tense, articles, prepositions, word order or word choice. "he go to work yesterday" stays "he go to work yesterday".
- NEVER add a word no recognizer heard, NEVER drop a word the recognizers agree on. Your sentence must have about the same number of words as the transcripts.
- Keep repetitions and false starts as spoken ("I I went").
- Remove only filled pauses (uh, um, er, euh, eh, ehm, äh, ähm, eeh).
- When unsure, keep what the recognizers heard.

Return ONLY JSON, no markdown fences:
{"intended": "<the sentence>", "changes": [{"heard": "<word>", "intended": "<word>"}]}
List in "changes" only words you replaced relative to transcript 1.`;

interface Reconstruction {
  intended: string;
  changes: Array<{ heard: string; intended: string }>;
}

async function reconstructIntended(
  liveText: string,
  langLabel: string,
  context: string,
  dg: DgEvidence | null,
  azText: string,
): Promise<Reconstruction> {
  const evidence =
    `Language: ${langLabel}\n` +
    (context ? `Examiner's question: "${context}"\n` : "") +
    `\nTranscript 1:\n"${liveText}"\n` +
    (dg
      ? `\nTranscript 2:\n"${dg.transcript}"\nPer-word confidence: ${dg.words.map((w) => `${w.word}(${w.confidence})`).join(" ")}\n`
      : "") +
    (azText ? `\nTranscript 3:\n"${azText}"\n` : "");

  // One retry: a malformed JSON reply is the usual failure, and it's transient.
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const text = (
        await mistralComplete({
          model: mistralPronunciationModel(),
          system: RECONSTRUCT_SYSTEM,
          messages: [{ role: "user", content: evidence }],
          maxTokens: 1500,
          json: true,
          context: "pronunciation-reconstruct",
        })
      ).trim();
      const parsed = JSON.parse(text.replace(/^```json\s*|\s*```$/g, "").trim()) as Reconstruction;
      if (typeof parsed.intended !== "string" || !parsed.intended.trim()) {
        throw new Error("reconstruction returned no sentence");
      }
      return { intended: parsed.intended.trim(), changes: Array.isArray(parsed.changes) ? parsed.changes : [] };
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

async function assess({
  audio,
  contentType,
  langCode,
  referenceText = "",
  context = "",
  clientWpm = 0,
}: PronunciationAssessParams): Promise<PronunciationResult | null> {
  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION ?? "westeurope";
  if (!key) throw new Error("AZURE_SPEECH_KEY missing");

  const langLabel = LANG_LABELS[langCode] ?? "English";

  const [dg, azFree] = await Promise.all([
    deepgramVerbatim(audio, contentType, langCode),
    azureAcoustic(audio, contentType, langCode, key, region),
  ]);
  const liveText = referenceText || dg?.transcript || azFree?.text || "";
  if (!liveText.trim()) return null;

  // Errors propagate on purpose: a failed step must show as a failed run,
  // not silently degrade into a different (circular) method.
  const { intended, changes } = await reconstructIntended(liveText, langLabel, context, dg, azFree?.text ?? "");
  const az = await azureAcoustic(audio, contentType, langCode, key, region, intended);
  if (!az) throw new Error("Azure scripted assessment returned no result");

  const words = az.words
    .filter((w) => w.errorType !== "Insertion")
    .map((w) => ({
      word: w.word,
      confidence: discreteWordConfidence(w.accuracyScore, w.errorType),
      accuracyScore: w.errorType === "Omission" ? 0 : w.accuracyScore,
      errorType: w.errorType,
    }));
  const matched = words.filter((w) => w.errorType !== "Omission");
  if (!matched.length) throw new Error("Azure matched none of the intended words");
  const score = Math.round(matched.reduce((s, w) => s + w.accuracyScore, 0) / matched.length);

  // Same pause-inclusive WPM as azure-ensemble: words actually spoken over
  // the whole trimmed clip.
  const spoken = az.words.filter((w) => w.errorType !== "Omission").length;
  const wpm = az.durationSec > 0.5 && spoken >= 6 ? Math.round((spoken / az.durationSec) * 60) : clientWpm;

  console.log(
    `[pronunciation] intended score=${score} omissions=${words.length - matched.length}` +
      ` changes=${changes.map((c) => `${c.heard}→${c.intended}`).join(" ") || "none"} intended="${intended.slice(0, 80)}"`
  );

  return {
    text: intended,
    pronunciationScore: score,
    accuracyScore: score,
    wpm,
    words,
    source: "azure",
  };
}

export const azureIntendedProvider: PronunciationProvider = {
  id: "azure-intended",
  label: "Azure scripted on intended text (experimental)",
  modelLabel: `Deepgram nova-3 + Azure free-speech + ${mistralPronunciationModel()} reconstruction + Azure Pronunciation Assessment (scripted)`,
  assess,
};
