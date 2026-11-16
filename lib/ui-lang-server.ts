import { cookies, headers } from "next/headers";
import { DEFAULT_UI_LANG, UI_LANG_COOKIE, UI_STRINGS, isUiLang, uiLangFromPreferences, type UiLang, type UiStrings } from "@/lib/ui-strings";

/** The interface language for a server component — same order as the browser (lib/ui-lang.tsx): the stored choice, then the browser's Accept-Language, then French. */
export async function getUiServer(): Promise<{ lang: UiLang; t: UiStrings }> {
  const v = (await cookies()).get(UI_LANG_COOKIE)?.value;
  const accept = (await headers()).get("accept-language") ?? "";
  const lang = isUiLang(v) ? v : (uiLangFromPreferences(accept.split(",")) ?? DEFAULT_UI_LANG);
  return { lang, t: UI_STRINGS[lang] };
}
