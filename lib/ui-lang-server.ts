import { cookies } from "next/headers";
import { DEFAULT_UI_LANG, UI_LANG_COOKIE, UI_STRINGS, isUiLang, type UiLang, type UiStrings } from "@/lib/ui-strings";

/** The interface language for a server component: the cookie set from `?ui=` (lib/ui-lang.tsx), else French. */
export async function getUiServer(): Promise<{ lang: UiLang; t: UiStrings }> {
  const v = (await cookies()).get(UI_LANG_COOKIE)?.value;
  const lang = isUiLang(v) ? v : DEFAULT_UI_LANG;
  return { lang, t: UI_STRINGS[lang] };
}
