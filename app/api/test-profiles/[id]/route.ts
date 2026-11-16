import { NextResponse } from "next/server";
import { getProfile, saveProfile } from "@/lib/test-profiles";
import { parseProfileInput } from "@/lib/test-profile-types";

export const runtime = "nodejs";

/**
 * PUT /api/test-profiles/:id — admin-only (middleware.ts): replaces the
 * profile and its questions with the editor's state (order = array order;
 * questions left out are deleted).
 */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!(await getProfile(id))) return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    const profile = parseProfileInput(await req.json(), id);
    return NextResponse.json({ profile: await saveProfile(profile) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
