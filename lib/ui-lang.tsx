"use client";

/**
 * The candidate's interface language (roadmap L-02/L-03), shared with every
 * candidate component through context.
 *
 * Source, in order: `?ui=<lang>` on the link (remembered in a cookie so the
 * dashboard, the account pages — server-rendered, see lib/ui-lang-server.ts —
 * and later visits keep it), then the cookie, then French. The API test row
 * will become a source too (phase 2).
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { DEFAULT_UI_LANG, UI_LANG_COOKIE, UI_STRINGS, isUiLang, type UiLang, type UiStrings } from "@/lib/ui-strings";

export function readUiLang(): UiLang {
  if (typeof window === "undefined") return DEFAULT_UI_LANG;
  const fromUrl = new URLSearchParams(window.location.search).get("ui");
  if (isUiLang(fromUrl)) {
    document.cookie = `${UI_LANG_COOKIE}=${fromUrl}; path=/; max-age=31536000; SameSite=Lax`;
    return fromUrl;
  }
  const stored = document.cookie.split("; ").find((c) => c.startsWith(`${UI_LANG_COOKIE}=`))?.split("=")[1];
  return isUiLang(stored) ? stored : DEFAULT_UI_LANG;
}

/** Reads the interface language after mount (the server render is always French, so no hydration mismatch). */
export function useUiLangFromBrowser(): UiLang {
  const [lang, setLang] = useState<UiLang>(DEFAULT_UI_LANG);
  useEffect(() => {
    const l = readUiLang();
    setLang(l);
    document.documentElement.lang = UI_STRINGS[l].htmlLang;
  }, []);
  return lang;
}

/** null = no provider on this page: useUi() reads the remembered language itself. */
const UiLangContext = createContext<UiLang | null>(null);

export function UiLangProvider({ lang, children }: { lang: UiLang; children: ReactNode }) {
  return <UiLangContext.Provider value={lang}>{children}</UiLangContext.Provider>;
}

/** The interface language and its strings, for any candidate component under a UiLangProvider. */
export function useUi(): { lang: UiLang; t: UiStrings } {
  const provided = useContext(UiLangContext);
  const fromBrowser = useUiLangFromBrowser();
  const lang = provided ?? fromBrowser;
  return { lang, t: UI_STRINGS[lang] };
}
