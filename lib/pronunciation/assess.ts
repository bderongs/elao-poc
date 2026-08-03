import { getSupabaseServer } from "@/lib/supabase-server";
import { getTurnForAssessment } from "@/lib/sessions-service";
import { getProvider } from "@/lib/pronunciation/registry";
import type { TurnEvaluationRow } from "@/lib/types";

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
