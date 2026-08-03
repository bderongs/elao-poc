/**
 * Live pass-2 pronunciation assessment for a conversation turn.
 * Thin wrapper around the provider registry (lib/pronunciation/registry.ts) —
 * the actual triangulation logic lives in lib/pronunciation/providers/*, so
 * this route and the admin pronunciation-lab replay path share one
 * implementation. AZURE_SPEECH_KEY, DEEPGRAM_API_KEY, MISTRAL_API_KEY never
 * leave the server.
 */

import { getProvider } from "@/lib/pronunciation/registry";

export async function POST(req: Request) {
  const formData = await req.formData();
  const audio = formData.get("audio") as Blob | null;
  const langCode = (formData.get("language") as string | null) ?? "fr";
  const clientWpm = parseInt((formData.get("wpm") as string | null) ?? "0", 10);
  // Live transcript of this turn (the words shown in the UI).
  const referenceText = (formData.get("referenceText") as string | null) ?? "";
  // The examiner's question the learner was answering.
  const context = (formData.get("context") as string | null) ?? "";

  if (!audio || audio.size === 0) return new Response("No audio", { status: 400 });

  const rawType = audio.type ?? "";
  const contentType = rawType.includes("wav")
    ? "audio/wav; codecs=audio/pcm; samplerate=16000"
    : rawType.startsWith("audio/mp4")
    ? "audio/mp4"
    : "audio/webm;codecs=opus";

  console.log(`[pronunciation] blob=${audio.size}B type=${rawType} lang=${langCode} live="${referenceText.slice(0, 50)}"`);

  const audioBuf = await audio.arrayBuffer();

  try {
    const result = await getProvider("azure-ensemble").assess({
      audio: audioBuf,
      contentType,
      langCode,
      referenceText,
      context,
      clientWpm,
    });
    return Response.json(result);
  } catch (e) {
    console.error("[pronunciation] provider error:", e);
    return new Response(String(e instanceof Error ? e.message : e), { status: 500 });
  }
}
