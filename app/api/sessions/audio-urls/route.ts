import { createSessionAudioUploadUrls } from "@/lib/sessions-service";

export const runtime = "nodejs";

/**
 * POST /api/sessions/audio-urls — signed Storage upload URLs for a live
 * session's audio, requested right before the final POST /api/sessions so
 * the audio never passes through a Vercel function (4.5 MB body limit).
 * Public, same carve-out as POST /api/sessions (see middleware.ts).
 *
 * Body: { language, sessionExt?: "webm" | "ogg" | …, turns: [{ index, ext }] }
 * Returns: { session: { path, token } | null, turns: { [index]: { path, token } } }
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      language?: string;
      sessionExt?: string | null;
      turns?: Array<{ index: number; ext: string }>;
    };
    const result = await createSessionAudioUploadUrls({
      language: body.language ?? "en",
      sessionExt: body.sessionExt ?? null,
      turns: Array.isArray(body.turns) ? body.turns : [],
    });
    return Response.json(result);
  } catch (e) {
    console.error("[sessions] audio upload urls failed:", e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
