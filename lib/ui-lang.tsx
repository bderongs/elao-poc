"use client";

/**
 * The candidate's interface language (roadmap L-02/L-03), shared with every
 * candidate component through context.
 *
 * Source, in order: `?ui=<lang>` on the link (remembered in localStorage so
 * the dashboard and later visits keep it), then what was remembered, then
 * French. The API test row will become a source too (phase 2).
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { DEFAULT_UI_LANG, UI_STRINGS, isUiLang, type UiLang, type UiStrings } from "@/lib/ui-strings";

const STORAGE_KEY = "elao_ui_lang";

export function readUiLang(): UiLang {
  if (typeof window === "undefined") return DEFAULT_UI_LANG;
  const fromUrl = new URLSearchParams(window.location.search).get("ui");
  if (isUiLang(fromUrl)) {
    try {
      window.localStorage.setItem(STORAGE_KEY, fromUrl);
    } catch {
      /* storage blocked: the URL still wins for this page */
    }
    return fromUrl;
  }
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isUiLang(stored)) return stored;
  } catch {
    /* storage blocked */
  }
  return DEFAULT_UI_LANG;
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
