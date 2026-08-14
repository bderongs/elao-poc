import type { PronunciationAvg, TurnEvaluationRow } from "@/lib/types";
import type { PronunciationResult } from "@/lib/pronunciation/types";

/**
 * The single source of truth for which lib/pronunciation/registry.ts
 * provider is live — app/api/pronunciation/route.ts calls
 * getProvider(LIVE_CONVERSATION_PRONUNCIATION_PROVIDER_ID) directly, so this
 * constant IS the switch, not just a label for one. Was "azure-ensemble"
 * until the client confirmed Voxtral looks better on real sessions (M8
 * Track M, 2026-08-10); switched back to "azure-ensemble" on 2026-08-14 at
 * the client's request (Azure + Deepgram evidence, judged by Mistral) — voxtral
 * remains registered and available as an on-demand comparison run from the
 * admin gear. See lib/system-config.ts, which surfaces this (and the other 4
 * capabilities' live provider) in the admin UI and per-session logs/records.
 */
export const LIVE_CONVERSATION_PRONUNCIATION_PROVIDER_ID = "azure-ensemble";

/**
 * Session-level pronunciation aggregate from a set of per-turn results —
 * same formula as the live conversation UI's `pronunciationAvg` (app/page.tsx),
 * reimplemented here so uploaded sessions (no browser-side history array)
 * can get the same `PronunciationAvg` shape feeding into the CEFR eval prompt.
 */
export function computePronunciationAvg(results: PronunciationResult[]): PronunciationAvg | null {
  if (!results.length) return null;

  const avg = (key: "pronunciationScore" | "wpm") =>
    results.reduce((s, r) => s + (r[key] ?? 0), 0) / results.length;
  const pronunciation = avg("pronunciationScore");

  // WPM over substantive turns only (wpm=0 flags a turn too short to time),
  // word-weighted so a long turn counts more than a short one.
  const wpmTurns = results.filter((r) => (r.wpm ?? 0) > 0);
  const wordsOf = (r: PronunciationResult) =>
    r.words?.length || r.text.trim().split(/\s+/).filter(Boolean).length;
  const wpmWordTotal = wpmTurns.reduce((s, r) => s + wordsOf(r), 0);
  const wpm =
    wpmWordTotal > 0
      ? wpmTurns.reduce((s, r) => s + r.wpm * wordsOf(r), 0) / wpmWordTotal
      : 0;

  return {
    pronunciation,
    wpm,
    score: Math.round(pronunciation),
    count: results.length,
    shortTurns: results.filter((r) => (r.wpm ?? 0) === 0).length,
  };
}

/**
 * A single provider's session-level pronunciation average — one turn's LATEST
 * successful run from that provider, averaged across all turns. Unlike
 * `computePronunciationAvg` (which mixes whichever provider ran most recently
 * per turn), this isolates one provider so it can be compared head-to-head
 * against another, e.g. Azure vs. Voxtral against a Speechace import.
 */
export function pronunciationScoreByProvider(turnEvaluations: TurnEvaluationRow[], providerId: string): number | null {
  const latestByTurn = new Map<string, TurnEvaluationRow>();
  for (const row of turnEvaluations) {
    if (row.provider_id !== providerId || row.error || !row.result_json) continue;
    const existing = latestByTurn.get(row.turn_id);
    if (!existing || new Date(row.created_at) > new Date(existing.created_at)) {
      latestByTurn.set(row.turn_id, row);
    }
  }
  if (!latestByTurn.size) return null;
  const scores = Array.from(latestByTurn.values()).map((r) => r.result_json!.pronunciationScore);
  return scores.reduce((s, v) => s + v, 0) / scores.length;
}

/**
 * Whether a pronunciation provider already has a successful result for every
 * one of `turnIds` — used to grey out providers in the "run full evaluation"
 * gear that have already been fully solicited for this session, so a re-run
 * isn't accidentally re-billed (each run is a fresh paid ASR/judge call, never
 * cached — see lib/pronunciation/assess.ts) for no reason. A turn added after
 * the last run (e.g. via AddRecordingButton) breaks coverage and makes the
 * provider selectable again.
 */
export function pronunciationProviderFullyCovered(
  turnEvaluations: TurnEvaluationRow[],
  providerId: string,
  turnIds: string[],
): boolean {
  if (!turnIds.length) return false;
  const latestByTurn = new Map<string, TurnEvaluationRow>();
  for (const row of turnEvaluations) {
    if (row.provider_id !== providerId) continue;
    const existing = latestByTurn.get(row.turn_id);
    if (!existing || new Date(row.created_at) > new Date(existing.created_at)) {
      latestByTurn.set(row.turn_id, row);
    }
  }
  return turnIds.every((id) => {
    const row = latestByTurn.get(id);
    return !!row && !row.error && !!row.result_json;
  });
}

// A pending placeholder row (see lib/pronunciation/assess.ts) older than this
// is treated as abandoned rather than still running — assess-all's own route
// has a 300s maxDuration, so a row still unresolved well past that means the
// server process died mid-run (has happened during dev restarts) rather than
// genuinely still being in flight. Without this, an orphaned row would show
// "Running…" forever and permanently block that provider from being retried.
const PENDING_STALE_MS = 6 * 60_000;

/**
 * Whether a pronunciation provider has an unresolved run (a pending
 * placeholder row — see lib/pronunciation/assess.ts) for at least one of
 * `turnIds` — i.e. a batch/turn run was launched and hasn't finished yet.
 */
export function pronunciationProviderPending(
  turnEvaluations: TurnEvaluationRow[],
  providerId: string,
  turnIds: string[],
): boolean {
  const turnIdSet = new Set(turnIds);
  const latestByTurn = new Map<string, TurnEvaluationRow>();
  for (const row of turnEvaluations) {
    if (row.provider_id !== providerId || !turnIdSet.has(row.turn_id)) continue;
    const existing = latestByTurn.get(row.turn_id);
    if (!existing || new Date(row.created_at) > new Date(existing.created_at)) {
      latestByTurn.set(row.turn_id, row);
    }
  }
  return Array.from(latestByTurn.values()).some(
    (row) => !row.error && !row.result_json && Date.now() - new Date(row.created_at).getTime() < PENDING_STALE_MS
  );
}

export interface PronunciationAvgAttribution {
  providerIds: string[];
}

/**
 * Which pronunciation provider(s) actually fed the numbers currently sitting
 * in session.pronunciation_scores — mirrors recomputeSessionRollup's own
 * "first row seen per turn_id, newest-first" selection
 * (lib/sessions-service.ts) using the turnEvaluations the caller already
 * fetched (already ordered created_at desc), so no extra query is needed.
 * Only meaningful for upload/speechace sessions: recomputeSessionRollup
 * no-ops for conversation sessions, whose pronunciation_scores come from the
 * live flow instead.
 */
export function pronunciationAvgAttribution(turnEvaluations: TurnEvaluationRow[]): PronunciationAvgAttribution | null {
  const latestByTurn = new Map<string, TurnEvaluationRow>();
  for (const row of turnEvaluations) {
    if (!latestByTurn.has(row.turn_id)) latestByTurn.set(row.turn_id, row);
  }
  const contributing = Array.from(latestByTurn.values()).filter((r) => !r.error && r.result_json);
  if (!contributing.length) return null;
  return { providerIds: Array.from(new Set(contributing.map((r) => r.provider_id))) };
}
