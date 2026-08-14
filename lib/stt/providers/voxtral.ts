/**
 * Live speech-to-text via Mistral's dedicated audio-transcriptions endpoint
 * (lib/mistral.ts's mistralTranscribe) — transcription only, no judging.
 * Distinct from lib/pronunciation/providers/voxtral.ts (EO), which uses the
 * chat-completions-with-audio path because it needs to reason about
 * pronunciation quality, not just transcribe.
 */

import { mistralTranscribe, mistralTranscribeModel } from "@/lib/mistral";
import { assessProcessLabel } from "@/lib/turn-labels";
import { logServerEvent } from "@/lib/server-log";
import type { SttProvider, SttTranscribeParams, SttResult } from "@/lib/stt/types";

const LANG_CODES: Record<string, string> = {
  fr: "fr", "nl-BE": "nl", es: "es", it: "it", de: "de", en: "en",
};

async function transcribe({ audio, contentType, filename, langCode, turnLogId }: SttTranscribeParams): Promise<SttResult> {
  const processLabel = turnLogId ? assessProcessLabel("STT", turnLogId) : "voxtral-transcribe";
  logServerEvent("stt_request_received", { turnLogId, process: processLabel, blobSize: audio.byteLength });

  try {
    const { text, words } = await mistralTranscribe({
      audio,
      filename,
      contentType,
      language: LANG_CODES[langCode] ?? "en",
      context: processLabel,
    });

    // Elapsed time from first word to last, NOT raw span: a long internal
    // pause (thinking, breath) between two fast bursts of speech shouldn't
    // count as "slow speaking" — cap each inter-word gap at MAX_GAP_SECONDS
    // before summing, so a bursty-but-fast speaker isn't scored as sluggish
    // just because the clock kept running during their pauses. Confirmed
    // against a real session (2026-08-14, doc/assessment_process.md) where
    // this was crushing WPM ~144→82 for a speaker independently confirmed
    // to talk fast, entirely because of two ~2-5s thinking pauses.
    const MAX_GAP_SECONDS = 0.6;
    let wpm = 0;
    if (words && words.length >= 2) {
      let duration = words[0].end - words[0].start;
      for (let i = 1; i < words.length; i++) {
        const gap = Math.max(0, words[i].start - words[i - 1].end);
        duration += Math.min(gap, MAX_GAP_SECONDS) + (words[i].end - words[i].start);
      }
      if (duration >= 0.5) wpm = Math.round((words.length / duration) * 60);
    }

    logServerEvent("stt_complete", {
      turnLogId, process: processLabel,
      provider: "voxtral", model: mistralTranscribeModel(),
      chars: text.length, wpm,
    });
    return { text, wpm };
  } catch (e) {
    logServerEvent("stt_failed", { turnLogId, process: processLabel, error: String(e) });
    throw e instanceof Error ? e : new Error(String(e));
  }
}

export const voxtralSttProvider: SttProvider = {
  id: "voxtral",
  label: "Voxtral (dedicated transcription endpoint) — default",
  modelLabel: mistralTranscribeModel(),
  transcribe,
};
