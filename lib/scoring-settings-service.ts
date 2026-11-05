import { getSupabaseServer } from "@/lib/supabase-server";
import { DEFAULT_LEVEL_FLOORS, parseLevelFloors, withLevelFloors, type LevelFloors, type ScoringRules } from "@/lib/cefr-score";

// Admin-editable level cut-offs — see supabase/migrations/0017_scoring_settings.sql.
// One 'default' row; any level missing from it keeps DEFAULT_LEVEL_FLOORS.

export async function getLevelFloors(): Promise<LevelFloors> {
  const { data, error } = await getSupabaseServer().from("scoring_settings").select("level_floors").eq("id", "default").maybeSingle();
  // Migration 0017 not run yet: behave as the defaults rather than fail the page.
  if (error) {
    console.warn("[scoring-settings] read failed, using defaults:", error.message);
    return DEFAULT_LEVEL_FLOORS;
  }
  try {
    return parseLevelFloors(data?.level_floors);
  } catch (e) {
    console.warn("[scoring-settings] stored floors invalid, using defaults:", e instanceof Error ? e.message : e);
    return DEFAULT_LEVEL_FLOORS;
  }
}

/** SCORING_RULES with the admin's level floors — what server pages score with. */
export async function getLiveScoringRules(): Promise<ScoringRules> {
  return withLevelFloors(await getLevelFloors());
}

export async function saveLevelFloors(floors: LevelFloors): Promise<void> {
  const { error } = await getSupabaseServer()
    .from("scoring_settings")
    .upsert({ id: "default", level_floors: floors, updated_at: new Date().toISOString() }, { onConflict: "id" });
  if (error) throw new Error(error.message);
}
