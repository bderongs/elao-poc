/**
 * Pre-test room check (doc/feature-1-background-noise-plan.md, Part B).
 *
 * From the mic-check screen's level readings (app/page.tsx's meter loop, one
 * RMS reading every 80 ms), estimates the room's background level and the
 * candidate's voice level, and decides whether the screen shows a soft
 * warning. Never blocking — the candidate can always start.
 *
 * Judges the gap between voice and background as well as absolute levels:
 * the assessment stream has autoGainControl off (see ensureMicStream), so the
 * same room reads very differently on two mics, while the gap doesn't.
 *
 * All thresholds are starting values, to recalibrate from the `mic_check`
 * client-log events.
 */

/** Readings kept for the assessment — ~5 s at the meter's 80 ms rate. */
export const NOISE_CHECK_WINDOW = 62;
/** No verdict before ~3 s of readings. */
const MIN_READINGS = 38;
/**
 * Background = a LOW percentile of the window, so the candidate saying
 * « bonjour » (the screen asks them to) doesn't count as room noise. Low
 * rather than the median: someone reading the instructions aloud fills most
 * of the window, but still leaves gaps between words.
 */
const FLOOR_PERCENTILE = 0.1;
const VOICE_PERCENTILE = 0.95;
/** The loud end of the window only counts as a voice this far above the background. */
const VOICE_MIN_ABOVE_FLOOR_DB = 10;
/** ≈ 0.0056 RMS — a quiet room on a laptop mic with AGC off sits around -60/-55 dBFS. */
const NOISY_FLOOR_DB = -45;
/** Voice heard, but standing less than this far above the room. */
const NOISY_SNR_DB = 15;
/** ≈ 0.01 RMS — the level of the quiet-mic candidate in doc/client-feedback-plan.md Y-04. */
const QUIET_VOICE_DB = -40;

export type RoomVerdict = "ok" | "noisy" | "quiet-voice" | "unknown";

export interface RoomAssessment {
  floorDb: number | null;
  /** null until a voice has been heard (see VOICE_MIN_ABOVE_FLOOR_DB). */
  voiceDb: number | null;
  snrDb: number | null;
  verdict: RoomVerdict;
}

/** RMS (0-1) → dBFS, floored at -100 so digital silence stays finite. */
export function rmsToDb(rms: number): number {
  return 20 * Math.log10(Math.max(rms, 1e-5));
}

function percentile(sorted: number[], p: number): number {
  return sorted[Math.round(p * (sorted.length - 1))];
}

export function assessRoom(readings: number[]): RoomAssessment {
  if (readings.length < MIN_READINGS) return { floorDb: null, voiceDb: null, snrDb: null, verdict: "unknown" };
  const sorted = readings.map(rmsToDb).sort((a, b) => a - b);
  const floorDb = percentile(sorted, FLOOR_PERCENTILE);
  const loudDb = percentile(sorted, VOICE_PERCENTILE);
  const voiceDb = loudDb - floorDb >= VOICE_MIN_ABOVE_FLOOR_DB ? loudDb : null;
  const snrDb = voiceDb === null ? null : voiceDb - floorDb;

  let verdict: RoomVerdict = "ok";
  if (floorDb > NOISY_FLOOR_DB || (snrDb !== null && snrDb < NOISY_SNR_DB)) verdict = "noisy";
  else if (voiceDb !== null && voiceDb < QUIET_VOICE_DB) verdict = "quiet-voice";
  return { floorDb, voiceDb, snrDb, verdict };
}
