/** Display metadata for a session's language code, shared by the dashboard list and detail pages. */
const LANGUAGE_LABELS: Record<string, { label: string; flag: string }> = {
  fr: { label: "Français", flag: "🇫🇷" },
  en: { label: "English", flag: "🇬🇧" },
  "nl-BE": { label: "Nederlands (BE)", flag: "🇧🇪" },
  es: { label: "Español", flag: "🇪🇸" },
  it: { label: "Italiano", flag: "🇮🇹" },
  de: { label: "Deutsch", flag: "🇩🇪" },
};

export function languageLabel(code: string | null): string {
  if (!code) return "—";
  return LANGUAGE_LABELS[code]?.label ?? code;
}

export function languageFlag(code: string | null): string {
  if (!code) return "🌐";
  return LANGUAGE_LABELS[code]?.flag ?? "🌐";
}
