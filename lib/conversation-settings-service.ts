import { getSupabaseServer } from "@/lib/supabase-server";
import type { ConvLang } from "@/lib/conversation-prompts";
import type { CefrRung } from "@/lib/cefr-rung";

// Admin-configurable knobs for the live conversation's adaptive-difficulty
// mechanism — see supabase/migrations/0007_conversation_settings.sql. One
// guaranteed 'default' row applies to every language; an optional
// per-language row overrides just that language.

export interface ConversationSettingsValues {
  startingRung: CefrRung;
  stepSize: number;
}

export interface ConversationSettingsListItem extends ConversationSettingsValues {
  language: "default" | ConvLang;
  isOverridden: boolean; // false = following 'default'; always true for 'default' itself
}

const LANGUAGES: ConvLang[] = ["fr", "en", "nl-BE", "es", "it", "de"];

// Defensive fallback if even the 'default' row is somehow missing — matches
// today's pre-existing hardcoded behavior ("A2" starting rung, step 1).
const HARDCODED_FALLBACK: ConversationSettingsValues = { startingRung: "A2", stepSize: 1 };

interface DbRow {
  language: string;
  starting_rung: CefrRung;
  step_size: number;
}

async function fetchAllRows(): Promise<DbRow[]> {
  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from("conversation_settings")
    .select("language, starting_rung, step_size");
  if (error) throw new Error(error.message);
  return (data ?? []) as DbRow[];
}

export async function resolveConversationSettings(language: ConvLang): Promise<ConversationSettingsValues> {
  const rows = await fetchAllRows();
  const languageRow = rows.find((r) => r.language === language);
  if (languageRow) return { startingRung: languageRow.starting_rung, stepSize: languageRow.step_size };
  const defaultRow = rows.find((r) => r.language === "default");
  if (defaultRow) return { startingRung: defaultRow.starting_rung, stepSize: defaultRow.step_size };
  return HARDCODED_FALLBACK;
}

export async function listConversationSettings(): Promise<ConversationSettingsListItem[]> {
  const rows = await fetchAllRows();
  const byLanguage = new Map(rows.map((r) => [r.language, r]));
  const defaultRow = byLanguage.get("default");
  const defaultValues: ConversationSettingsValues = defaultRow
    ? { startingRung: defaultRow.starting_rung, stepSize: defaultRow.step_size }
    : HARDCODED_FALLBACK;

  const defaultItem: ConversationSettingsListItem = { language: "default", isOverridden: true, ...defaultValues };
  const languageItems: ConversationSettingsListItem[] = LANGUAGES.map((language) => {
    const row = byLanguage.get(language);
    return row
      ? { language, isOverridden: true, startingRung: row.starting_rung, stepSize: row.step_size }
      : { language, isOverridden: false, ...defaultValues };
  });

  return [defaultItem, ...languageItems];
}

export async function upsertConversationSettingsOverride(
  language: "default" | ConvLang,
  values: ConversationSettingsValues
): Promise<void> {
  const supabase = getSupabaseServer();
  const { error } = await supabase.from("conversation_settings").upsert(
    {
      language,
      starting_rung: values.startingRung,
      step_size: values.stepSize,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "language" }
  );
  if (error) throw new Error(error.message);
}

// 'default' can never be deleted this way — every other language's fallback
// depends on it existing. The route handler rejects that case before calling
// this; the ConvLang-only param type keeps it out of reach at compile time too.
export async function deleteConversationSettingsOverride(language: ConvLang): Promise<void> {
  const supabase = getSupabaseServer();
  const { error } = await supabase.from("conversation_settings").delete().eq("language", language);
  if (error) throw new Error(error.message);
}
