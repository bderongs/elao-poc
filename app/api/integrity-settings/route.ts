import { NextResponse } from "next/server";
import { getIntegritySettings, saveIntegritySettings } from "@/lib/integrity-settings-service";
import { normalizeIntegritySettings } from "@/lib/integrity";

export const runtime = "nodejs";

/**
 * GET /api/integrity-settings — PUBLIC (middleware.ts lets GET through): the
 * live page only needs the on/off switch, so that is all it gets — the
 * thresholds stay out of candidates' reach.
 * PATCH /api/integrity-settings — admin-only, the full IntegritySettings.
 */
export async function GET() {
  const { enabled } = await getIntegritySettings();
  return NextResponse.json({ enabled });
}

export async function PATCH(req: Request) {
  try {
    const settings = normalizeIntegritySettings(await req.json());
    await saveIntegritySettings(settings);
    return NextResponse.json(settings);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
