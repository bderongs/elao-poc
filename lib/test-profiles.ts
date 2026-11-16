/**
 * Test profiles in the database (migration 0020) — server-only. Rules and
 * types: lib/test-profile-types.ts. Edited in /admin/profiles, read by the
 * chat route on every turn of a test taken with `?profile=<id>`.
 */
import { getSupabaseServer } from "@/lib/supabase-server";
import { isCefrRung, type CefrRung } from "@/lib/cefr-rung";
import { isConvLang } from "@/lib/conversation-prompts";
import { isProfileId, type ProfileQuestion, type TestProfile } from "@/lib/test-profile-types";

interface ProfileRow {
  id: string;
  name: string;
  language: string;
  min_questions: number;
  active: boolean;
}

interface QuestionRow {
  id: string;
  profile_id: string;
  position: number;
  text: string;
  simpler: string | null;
  min_level: string;
  max_level: string;
  active: boolean;
}

function toProfile(row: ProfileRow, questions: QuestionRow[]): TestProfile {
  return {
    id: row.id,
    name: row.name,
    language: isConvLang(row.language) ? row.language : "en",
    minQuestions: row.min_questions,
    active: row.active,
    questions: questions
      .filter((q) => q.profile_id === row.id)
      .sort((a, b) => a.position - b.position)
      .map(
        (q): ProfileQuestion => ({
          id: q.id,
          text: q.text,
          simpler: q.simpler,
          minLevel: (isCefrRung(q.min_level) ? q.min_level : "A1") as CefrRung,
          maxLevel: (isCefrRung(q.max_level) ? q.max_level : "C2") as CefrRung,
          active: q.active,
        })
      ),
  };
}

/** Every profile with its questions; [] when migration 0020 has not been run. */
export async function listProfiles(): Promise<TestProfile[]> {
  const db = getSupabaseServer();
  const [{ data: profiles, error }, { data: questions }] = await Promise.all([
    db.from("test_profiles").select("id, name, language, min_questions, active").order("name"),
    db.from("test_profile_questions").select("id, profile_id, position, text, simpler, min_level, max_level, active"),
  ]);
  if (error) {
    console.warn("[test-profiles] read failed (run migration 0020?):", error.message);
    return [];
  }
  return (profiles as ProfileRow[]).map((p) => toProfile(p, (questions ?? []) as QuestionRow[]));
}

export async function getProfile(id: string): Promise<TestProfile | null> {
  if (!isProfileId(id)) return null;
  const db = getSupabaseServer();
  const [{ data: profile, error }, { data: questions }] = await Promise.all([
    db.from("test_profiles").select("id, name, language, min_questions, active").eq("id", id).maybeSingle(),
    db.from("test_profile_questions").select("id, profile_id, position, text, simpler, min_level, max_level, active").eq("profile_id", id),
  ]);
  if (error) console.warn("[test-profiles] read failed (run migration 0020?):", error.message);
  return profile ? toProfile(profile as ProfileRow, (questions ?? []) as QuestionRow[]) : null;
}

// The chat route reads the profile on every turn: a short cache keeps that to
// one read per instance per minute. An admin edit shows up within a minute.
const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; profile: TestProfile | null }>();

/** The profile a live test should use: active, or null. */
export async function getLiveProfile(id: unknown): Promise<TestProfile | null> {
  if (!isProfileId(id)) return null;
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.profile;
  const profile = await getProfile(id);
  const live = profile?.active ? profile : null;
  cache.set(id, { at: Date.now(), profile: live });
  return live;
}

/** Creates or replaces a profile and its questions (order = array order). Questions left out are deleted. */
export async function saveProfile(profile: TestProfile): Promise<TestProfile> {
  const db = getSupabaseServer();
  const now = new Date().toISOString();
  const { error } = await db.from("test_profiles").upsert(
    { id: profile.id, name: profile.name, language: profile.language, min_questions: profile.minQuestions, active: profile.active, updated_at: now },
    { onConflict: "id" }
  );
  if (error) throw new Error(error.message);

  const keepIds = profile.questions.map((q) => q.id).filter((id): id is string => !!id);
  const { data: existing } = await db.from("test_profile_questions").select("id").eq("profile_id", profile.id);
  const toDelete = (existing ?? []).map((r) => r.id as string).filter((id) => !keepIds.includes(id));
  if (toDelete.length) {
    const { error: delError } = await db.from("test_profile_questions").delete().in("id", toDelete);
    if (delError) throw new Error(delError.message);
  }

  const rows = profile.questions.map((q, i) => ({
    ...(q.id ? { id: q.id } : {}),
    profile_id: profile.id,
    position: i + 1,
    text: q.text,
    simpler: q.simpler,
    min_level: q.minLevel,
    max_level: q.maxLevel,
    active: q.active,
    updated_at: now,
  }));
  const updates = rows.filter((r) => "id" in r);
  const inserts = rows.filter((r) => !("id" in r));
  if (updates.length) {
    const { error: upError } = await db.from("test_profile_questions").upsert(updates, { onConflict: "id" });
    if (upError) throw new Error(upError.message);
  }
  if (inserts.length) {
    const { error: insError } = await db.from("test_profile_questions").insert(inserts);
    if (insError) throw new Error(insError.message);
  }
  cache.delete(profile.id);
  const saved = await getProfile(profile.id);
  if (!saved) throw new Error("profile not found after save");
  return saved;
}
