import { NextResponse } from "next/server";
import {
  upsertConversationSettingsOverride,
  deleteConversationSettingsOverride,
} from "@/lib/conversation-settings-service";
import { isConvLang, type ConvLang } from "@/lib/conversation-prompts";
import { isCefrRung } from "@/lib/cefr-rung";

export const runtime = "nodejs";

/**
 * PATCH/DELETE /api/conversation-settings/:language — admin-only (gated by
 * middleware.ts). :language is 'default' (the global row) or one of the six
 * ConvLang codes (a per-language override).
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ language: string }> }) {
  const { language } = await params;
  if (language !== "default" && !isConvLang(language)) {
    return NextResponse.json({ error: "Invalid language" }, { status: 400 });
  }

  const { startingRung, stepSize } = await req.json();
  if (!isCefrRung(startingRung)) {
    return NextResponse.json({ error: "Invalid startingRung" }, { status: 400 });
  }
  if (!Number.isInteger(stepSize) || stepSize < 1 || stepSize > 4) {
    return NextResponse.json({ error: "stepSize must be an integer between 1 and 4" }, { status: 400 });
  }

  try {
    await upsertConversationSettingsOverride(language as "default" | ConvLang, { startingRung, stepSize });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ language: string }> }) {
  const { language } = await params;
  if (language === "default") {
    return NextResponse.json(
      { error: "Can't delete the default row — every language's fallback depends on it." },
      { status: 400 }
    );
  }
  if (!isConvLang(language)) {
    return NextResponse.json({ error: "Invalid language" }, { status: 400 });
  }

  try {
    await deleteConversationSettingsOverride(language);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
