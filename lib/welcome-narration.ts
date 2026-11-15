/**
 * Spoken version of the welcome page (roadmap L-05): the text a "Listen"
 * button reads out, for candidates who'd rather hear the page than read it.
 *
 * The audio is generated once per interface language by
 * scripts/generate-welcome-audio.ts (public/audio/welcome/<lang>.mp3), not
 * synthesised per visit. The script records a hash of the text it read in
 * lib/welcome-audio.json; the page shows the button only when that hash
 * matches today's text, so a wording change never plays stale audio — it
 * hides the button until the script is run again.
 */
import { AVATAR_NAME } from "@/lib/session-config";
import type { ConvLang } from "@/lib/conversation-prompts";
import type { UiLang, UiStrings } from "@/lib/ui-strings";
import generated from "@/lib/welcome-audio.json";

/** The voice that reads each interface language (the Dutch interface reads with the Belgian voice). */
export const WELCOME_VOICE_LANG: Record<UiLang, ConvLang> = {
  fr: "fr", en: "en", nl: "nl-BE", es: "es", it: "it", de: "de",
};

const sentence = (s: string) => (/[.!?…]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);

/** What the narration says, in the page's order: title, lead, the three steps, the practical note. */
export function welcomeNarration(t: UiStrings): string {
  const steps = t.welcome.steps(AVATAR_NAME).map(([title, desc], i) => `${i + 1}. ${sentence(title)} ${sentence(desc)}`);
  return [sentence(`${t.welcome.titleLine1} ${t.welcome.titleLine2}`), sentence(t.welcome.lead(t.sessionLength, AVATAR_NAME)), ...steps, sentence(t.welcome.quietPlace)].join("\n");
}

/** FNV-1a, 32-bit, hex — only to tell whether the text changed since the audio was made. */
export function narrationHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** URL of the up-to-date narration for this language, or null (never generated, or the text changed since). */
export function welcomeAudioUrl(lang: UiLang, t: UiStrings): string | null {
  const hash = (generated as Partial<Record<UiLang, string>>)[lang];
  return hash && hash === narrationHash(welcomeNarration(t)) ? `/audio/welcome/${lang}.mp3?v=${hash}` : null;
}
