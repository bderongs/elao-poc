import { NextResponse } from "next/server";
import { getProfile, listProfiles, saveProfile } from "@/lib/test-profiles";
import { isProfileId, parseProfileInput } from "@/lib/test-profile-types";

export const runtime = "nodejs";

/**
 * Test profiles (roadmap phase 3) — admin-only (middleware.ts).
 * GET  /api/test-profiles → { profiles }
 * POST /api/test-profiles { id, name, language } → creates an empty profile (min 0 questions until some are added).
 */
export async function GET() {
  return NextResponse.json({ profiles: await listProfiles() });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!isProfileId(id)) throw new Error("Id: 2 to 40 characters — lowercase letters, digits and dashes.");
    if (await getProfile(id)) throw new Error(`A profile "${id}" already exists.`);
    const profile = parseProfileInput({ name: body.name, language: body.language, minQuestions: 0, questions: [] }, id);
    return NextResponse.json({ profile: await saveProfile(profile) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
