import { getSupabaseServer } from "@/lib/supabase-server";
import { DEFAULT_INTEGRITY_SETTINGS, normalizeIntegritySettings, type IntegritySettings } from "@/lib/integrity";

// Admin-editable settings for response timing and integrity signals — see
// supabase/migrations/0016_session_integrity.sql. One 'default' row; any
// field missing from it falls back to DEFAULT_INTEGRITY_SETTINGS.

export async function getIntegritySettings(): Promise<IntegritySettings> {
  const { data, error } = await getSupabaseServer().from("integrity_settings").select("settings").eq("id", "default").maybeSingle();
  // Migration 0016 not run yet: behave as the defaults rather than fail the page.
  if (error) {
    console.warn("[integrity-settings] read failed, using defaults:", error.message);
    return DEFAULT_INTEGRITY_SETTINGS;
  }
  return normalizeIntegritySettings(data?.settings);
}

export async function saveIntegritySettings(settings: IntegritySettings): Promise<void> {
  const { error } = await getSupabaseServer()
    .from("integrity_settings")
    .upsert({ id: "default", settings, updated_at: new Date().toISOString() }, { onConflict: "id" });
  if (error) throw new Error(error.message);
}
