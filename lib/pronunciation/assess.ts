import { getSupabaseServer } from "@/lib/supabase-server";
import { getTurnForAssessment } from "@/lib/sessions-service";
import { getProvider } from "@/lib/pronunciation/registry";
import { getProvider as getSttProvider, LIVE_STT_PROVIDER_ID } from "@/lib/stt/registry";
import type { TurnEvaluationRow } from "@/lib/types";

function audioExtension(contentType: string): string {
  return contentType.includes("wav") ? "wav" : contentType.includes("mp4") ? "m4a" : "webm";
}

/**
 * Runs one recording through one or more pronunciation providers and persists
 * each result to session_turn_evaluations. Shared by the single-turn assess
 * route and the session-wide "run full evaluation" batch route.
 */
export async function assessTurn(turnId: string, providerIds: string[]): Promise<TurnEvaluationRow[]> {
  const turn = await getTurnForAssessment(turnId);
  if (!turn) throw new Error("turn not found");
  if (!turn.audioUrl) throw new Error("turn has no recording");

  const audioRes = await fetch(turn.audioUrl);
  if (!audioRes.ok) throw new Error(`failed to fetch recording: HTTP ${audioRes.status}`);
  const contentType = audioRes.headers.get("content-type") || "audio/webm;codecs=opus";
  const audioBuf = await audioRes.arrayBuffer();

  const supabase = getSupabaseServer();

  // A real conversation turn's content is a genuine live ASR transcript worth
  // aligning to. An uploaded or Speechace-imported turn's content is already
  // some OTHER provider's transcript — feeding that in here would bias this
  // run toward agreeing with that earlier transcript instead of hearing the
  // audio independently.
  const referenceText = turn.source === "conversation" ? turn.content || undefined : undefined;

  // Voxtral (the default provider) has no independent duration signal of its
  // own — a live turn gets a real one from the STT step that already runs
  // ahead of it (lib/turn-vad.ts / app/api/transcribe/route.ts); a replayed
  // turn here has no equivalent step, so without this it silently falls back
  // to 0 (see lib/pronunciation/providers/voxtral.ts's clientWpm fallback),
  // which then poisons the WPM-anchored fluency dimension of any CEFR read
  // that uses this session's rollup (lib/cefr-prompt.ts). Probe it once per
  // turn (shared across all requested providers, not once each) using the
  // same STT registry the live path uses. Best-effort: azure-ensemble
  // computes its own, more accurate wpm from Azure's own timing and only
  // falls back to this on failure — see azure-ensemble.ts's own `wpm` calc.
  let clientWpm = 0;
  try {
    const sttResult = await getSttProvider(LIVE_STT_PROVIDER_ID).transcribe({
      audio: audioBuf,
      contentType,
      filename: `turn.${audioExtension(contentType)}`,
      langCode: turn.language,
    });
    clientWpm = sttResult.wpm;
  } catch (e) {
    console.warn(`[assess] wpm probe failed for turn ${turnId}:`, e);
  }

  return Promise.all(
    providerIds.map(async (providerId) => {
      const startedAt = Date.now();

      // Insert a pending placeholder immediately, before the (slow, external)
      // provider call — result_json and error both stay null while it's in
      // flight, so a page load mid-run shows "running" instead of nothing,
      // and refreshing right after clicking Run doesn't look like it did
      // nothing. Finalized in place via update() below, not a second insert,
      // so there's exactly one row per run, not two.
      const { data: pendingRow, error: pendingError } = await supabase
        .from("session_turn_evaluations")
        .insert({ turn_id: turnId, provider_id: providerId })
        .select("*")
        .single();
      if (pendingError || !pendingRow) {
        throw new Error(pendingError?.message ?? "failed to create pending evaluation row");
      }

      try {
        const provider = getProvider(providerId);
        const resultJson = await provider.assess({
          audio: audioBuf,
          contentType,
          langCode: turn.language,
          referenceText,
          clientWpm,
        });
        const durationMs = Date.now() - startedAt;

        const { data: row, error: updateError } = await supabase
          .from("session_turn_evaluations")
          .update({ result_json: resultJson, duration_ms: durationMs })
          .eq("id", pendingRow.id)
          .select("*")
          .single();

        if (updateError) throw new Error(updateError.message);
        return row as TurnEvaluationRow;
      } catch (e) {
        const durationMs = Date.now() - startedAt;
        const { data: row } = await supabase
          .from("session_turn_evaluations")
          .update({ error: String(e), duration_ms: durationMs })
          .eq("id", pendingRow.id)
          .select("*")
          .single();
        return (row as TurnEvaluationRow) ?? ({ ...pendingRow, error: String(e) } as TurnEvaluationRow);
      }
    }),
  );
}
