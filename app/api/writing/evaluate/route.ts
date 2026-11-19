import { NextResponse } from "next/server";
import { evaluateWriting, invalidTexts } from "@/lib/writing/evaluate";
import { isWritingLang } from "@/lib/writing/types";
import { logServerEvent } from "@/lib/server-log";

// Four to eight calls to the large model (three surveys, one band pass, retries).
export const maxDuration = 300;

/**
 * POST { language: "fr" | "en", uiLang?: string, texts: [string, string, string] }
 * → { result: WritingResult }. Public (the /ecrit page), rate-limited per IP
 * in middleware.ts. Nothing is stored.
 */
export async function POST(req: Request) {
  let body: { language?: unknown; uiLang?: unknown; texts?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!isWritingLang(body.language)) return NextResponse.json({ error: "invalid_language" }, { status: 400 });
  const invalid = invalidTexts(body.texts, body.language);
  if (invalid) return NextResponse.json({ error: "invalid_texts", detail: invalid }, { status: 400 });

  try {
    const result = await evaluateWriting({
      language: body.language,
      texts: body.texts as string[],
      notesLang: body.uiLang === "fr" ? "fr" : "en",
    });
    return NextResponse.json({ result });
  } catch (e) {
    logServerEvent("writing_evaluation_failed", { error: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: "evaluation_failed" }, { status: 502 });
  }
}
