/**
 * Synthetic "audio" figures for text-only simulations (lib/conversation-sim.ts).
 * A live session hands the evaluator a pronunciation score and a speaking rate
 * from the audio engines; a simulation has neither, so its score would be the
 * mean of 3 axes instead of 4 and skip the WPM→fluency clamp (AB-07). These
 * ranges stand in for a learner of the given level, so the live scoring path
 * runs end to end.
 *
 * The ranges overlap between levels on purpose, and are anchored on
 * FLUENCY_WPM_BANDS (lib/cefr-prompt.ts). They are derived from the simulated
 * level, so they pull the score towards the right answer — compare with the
 * text-only evaluation before trusting an assessment result.
 */

import type { CefrRung } from "@/lib/cefr-rung";
import type { PronunciationAvg } from "@/lib/types";

/** What gets sampled before the session; the counts come from the answers at the end. */
export interface SimAudioProxy {
  pronunciation: number;
  wpm: number;
}

export const SIM_AUDIO_RANGES: Record<CefrRung, { wpm: [number, number]; pronunciation: [number, number] }> = {
  A1: { wpm: [40, 58], pronunciation: [55, 68] },
  A2: { wpm: [55, 78], pronunciation: [62, 74] },
  B1: { wpm: [72, 100], pronunciation: [68, 80] },
  B2: { wpm: [95, 122], pronunciation: [75, 86] },
  C1: { wpm: [112, 140], pronunciation: [82, 91] },
  C2: { wpm: [128, 155], pronunciation: [87, 95] },
};

const uniform = ([lo, hi]: [number, number]) => lo + Math.random() * (hi - lo);

export function sampleAudioProxy(level: CefrRung): SimAudioProxy {
  const r = SIM_AUDIO_RANGES[level];
  return { pronunciation: Math.round(uniform(r.pronunciation)), wpm: Math.round(uniform(r.wpm)) };
}

/** Same shape app/page.tsx builds from real audio: short turns (< 6 words) carry no WPM there. */
export function audioProxyAverage(proxy: SimAudioProxy, userTurns: string[]): PronunciationAvg {
  const shortTurns = userTurns.filter((t) => t.trim().split(/\s+/).filter(Boolean).length < 6).length;
  return { pronunciation: proxy.pronunciation, wpm: proxy.wpm, score: Math.round(proxy.pronunciation), count: userTurns.length, shortTurns };
}
