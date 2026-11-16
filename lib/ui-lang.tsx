"use client";

/**
 * The candidate's interface language (roadmap L-02/L-03), shared with every
 * candidate component through context.
 *
 * Source, in order: `?ui=<lang>` on the link, then the candidate's own
 * choice (both remembered in a cookie, which server-rendered pages read too —
 * lib/ui-lang-server.ts), then the browser's language, then French. The API
 * test row will become a source too (phase 2). Only explicit choices are
 * stored; the browser language is re-read each time.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { DEFAULT_UI_LANG, UI_LANG_COOKIE, UI_STRINGS, isUiLang, uiLangFromPreferences, type UiLang, type UiStrings } from "@/lib/ui-strings";

/** Remembers an explicit choice (link parameter or the switcher). */
export function storeUiLang(lang: UiLang) {
  document.cookie = `${UI_LANG_COOKIE}=${lang}; path=/; max-age=31536000; SameSite=Lax`;
  document.documentElement.lang = UI_STRINGS[lang].htmlLang;
}

export function readUiLang(): UiLang {
  if (typeof window === "undefined") return DEFAULT_UI_LANG;
  const fromUrl = new URLSearchParams(window.location.search).get("ui");
  if (isUiLang(fromUrl)) {
    storeUiLang(fromUrl);
    return fromUrl;
  }
  const stored = document.cookie.split("; ").find((c) => c.startsWith(`${UI_LANG_COOKIE}=`))?.split("=")[1];
  if (isUiLang(stored)) return stored;
  return uiLangFromPreferences(navigator.languages?.length ? navigator.languages : [navigator.language]) ?? DEFAULT_UI_LANG;
}

/** Reads the interface language after mount (the server render is always French, so no hydration mismatch). */
export function useUiLangFromBrowser(): [UiLang, (lang: UiLang) => void] {
  const [lang, setLang] = useState<UiLang>(DEFAULT_UI_LANG);
  useEffect(() => {
    const l = readUiLang();
    setLang(l);
    document.documentElement.lang = UI_STRINGS[l].htmlLang;
  }, []);
  return [lang, setLang];
}

/** null = no provider on this page: useUi() reads the remembered language itself. */
const UiLangContext = createContext<{ lang: UiLang; setLang: (lang: UiLang) => void } | null>(null);

export function UiLangProvider({ lang, setLang, children }: { lang: UiLang; setLang: (lang: UiLang) => void; children: ReactNode }) {
  return <UiLangContext.Provider value={{ lang, setLang }}>{children}</UiLangContext.Provider>;
}

/**
 * Switches the interface language: in place under a provider (the test page
 * keeps its state), otherwise by reloading — those pages are server-rendered
 * and read the cookie.
 */
export function useSetUiLang(): (lang: UiLang) => void {
  const ctx = useContext(UiLangContext);
  return (lang: UiLang) => {
    storeUiLang(lang);
    if (ctx) ctx.setLang(lang);
    else window.location.reload();
  };
}

/** The interface language and its strings, for any candidate component under a UiLangProvider. */
export function useUi(): { lang: UiLang; t: UiStrings } {
  const provided = useContext(UiLangContext);
  const [fromBrowser] = useUiLangFromBrowser();
  const lang = provided?.lang ?? fromBrowser;
  return { lang, t: UI_STRINGS[lang] };
}
