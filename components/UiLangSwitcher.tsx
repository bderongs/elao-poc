"use client";

import { useSetUiLang, useUi } from "@/lib/ui-lang";
import { UI_LANGS, UI_LANG_NATIVE_NAME, type UiLang } from "@/lib/ui-strings";

/** Interface-language menu for the candidate top bars ("FR ▾"). Each language is listed in its own name. */
export function UiLangSwitcher({ light = true }: { light?: boolean }) {
  const { lang, t } = useUi();
  const setLang = useSetUiLang();
  return (
    <select
      aria-label={t.nav.interfaceLanguage}
      title={t.nav.interfaceLanguage}
      value={lang}
      onChange={(e) => setLang(e.target.value as UiLang)}
      style={{
        fontFamily: "'IBM Plex Mono',monospace",
        fontSize: 13,
        letterSpacing: "0.06em",
        color: light ? "#5A5F6E" : "#94a3b8",
        background: "transparent",
        border: "none",
        padding: "6px 2px",
        cursor: "pointer",
      }}
    >
      {UI_LANGS.map((l) => (
        <option key={l} value={l}>
          {l.toUpperCase()} · {UI_LANG_NATIVE_NAME[l]}
        </option>
      ))}
    </select>
  );
}
