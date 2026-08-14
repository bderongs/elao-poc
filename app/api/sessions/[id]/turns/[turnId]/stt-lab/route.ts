import { getTurnForAssessment } from "@/lib/sessions-service";
import { getProvider, LIVE_STT_PROVIDER_ID } from "@/lib/stt/registry";

export const runtime = "nodejs";

function audioExtension(contentType: string): string {
  return contentType.includes("wav") ? "wav" : contentType.includes("mp4") ? "m4a" : "webm";
}

/**
 * POST /api/sessions/:id/turns/:turnId/stt-lab
 * Re-transcribes one recording with today's live STT provider so it can be
 * diffed (client-side, lib/text-diff.ts) against the transcript actually
 * stored for this turn — the regression check for STT drift that the
 * pronunciation/CEFR labs don't cover, since both of those replay against
 * the frozen stored text rather than the audio (see doc/assessment_process.md).
 * Ephemeral by design: nothing here is persisted, this is a read-only spot
 * check, not a scored provider result other UI depends on.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string; turnId: string }> }) {
  const { turnId } = await params;

  try {
    const turn = await getTurnForAssessment(turnId);
    if (!turn) return Response.json({ error: "turn not found" }, { status: 404 });
    if (!turn.audioUrl) return Response.json({ error: "turn has no recording" }, { status: 400 });

    const audioRes = await fetch(turn.audioUrl);
    if (!audioRes.ok) {
      return Response.json({ error: `failed to fetch recording: HTTP ${audioRes.status}` }, { status: 502 });
    }
    const contentType = audioRes.headers.get("content-type") || "audio/webm;codecs=opus";
    const audioBuf = await audioRes.arrayBuffer();

    const result = await getProvider(LIVE_STT_PROVIDER_ID).transcribe({
      audio: audioBuf,
      contentType,
      filename: `turn.${audioExtension(contentType)}`,
      langCode: turn.language,
    });

    return Response.json({ text: result.text, wpm: result.wpm });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
