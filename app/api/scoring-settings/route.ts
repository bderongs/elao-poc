import { NextResponse } from "next/server";
import { getLevelFloors, saveLevelFloors } from "@/lib/scoring-settings-service";
import { parseLevelFloors } from "@/lib/cefr-score";

export const runtime = "nodejs";

/**
 * GET /api/scoring-settings — PUBLIC (middleware.ts lets GET through): the
 * live results screen labels the score with the same cut-offs as the admin.
 * PATCH /api/scoring-settings — admin-only, { levelFloors }.
 */
export async function GET() {
  return NextResponse.json({ levelFloors: await getLevelFloors() });
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const levelFloors = parseLevelFloors(body?.levelFloors);
    await saveLevelFloors(levelFloors);
    return NextResponse.json({ levelFloors });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
