/**
 * Blocking transcription-only call for the live conversation's turn-taking
 * (lib/turn-vad.ts detects the turn boundary client-side, this endpoint
 * turns that audio into text) — separate from pronunciation ASSESSMENT
 * (app/api/pronunciation/route.ts, still fires non-blocking/best-effort).
 * Uses the STT provider registry (lib/stt/registry.ts) — same pattern as
 * pronunciation/CEFR-eval — so the live provider is a single, explicit
 * switch (LIVE_STT_PROVIDER_ID), not a literal buried in this route.
 * MISTRAL_API_KEY never leaves the server.
 */

import { getProvider, LIVE_STT_PROVIDER_ID } from "@/lib/stt/registry";

export async function POST(req: Request) {
  const formData = await req.formData();
  const audio = formData.get("audio") as Blob | null;
  const langCode = (formData.get("language") as string | null) ?? "fr";
  const turnLogId = (formData.get("turnLogId") as string | null) ?? undefined;

  if (!audio || audio.size === 0) return new Response("No audio", { status: 400 });

  const rawType = audio.type ?? "";
  const contentType = rawType.includes("wav")
    ? "audio/wav"
    : rawType.startsWith("audio/mp4")
    ? "audio/mp4"
    : "audio/webm";
  const ext = contentType.includes("wav") ? "wav" : contentType.includes("mp4") ? "m4a" : "webm";

  try {
    const audioBuf = await audio.arrayBuffer();
    const result = await getProvider(LIVE_STT_PROVIDER_ID).transcribe({
      audio: audioBuf,
      contentType,
      filename: `turn.${ext}`,
      langCode,
      turnLogId,
    });
    return Response.json(result);
  } catch (e) {
    console.error("[transcribe] error:", e);
    return new Response(String(e instanceof Error ? e.message : e), { status: 500 });
  }
}
