/**
 * Test profiles (roadmap phase 3): a client's own questions, asked during the
 * conversation next to the standard bank. Pure types and rules — shared by
 * the admin editor (browser), the chat route and lib/examiner-prompt.ts.
 * Storage: lib/test-profiles.ts (migration 0020).
 *
 * A question has a level RANGE (minLevel..maxLevel): it can be asked whenever
 * the conversation's target level is inside it. Each profile asks at least
 * `minQuestions` per test; once the end nears (`urgent`), the missing ones are
 * asked anyway, the one whose range is closest to the current level first.
 */
import { CEFR_LADDER, isCefrRung, type CefrRung } from "@/lib/cefr-rung";
import type { ConvLang } from "@/lib/conversation-prompts";

/** The tested languages a profile can be for — kept here (not imported) so this file stays light in the browser. */
export const PROFILE_LANGUAGES: readonly ConvLang[] = ["en", "fr", "nl-BE", "nl-NL", "es", "it", "de"];
const isProfileLanguage = (v: unknown): v is ConvLang => (PROFILE_LANGUAGES as readonly unknown[]).includes(v);

export interface ProfileQuestion {
  /** Database id (uuid); absent on a question just added in the editor. */
  id?: string;
  text: string;
  /** Easier wording, asked when the candidate says they didn't understand. */
  simpler: string | null;
  minLevel: CefrRung;
  maxLevel: CefrRung;
  active: boolean;
}

export interface TestProfile {
  /** Slug, also what goes in the test link: `?profile=<id>`. */
  id: string;
  name: string;
  /** The tested language it applies to; a test in another language ignores the profile. */
  language: ConvLang;
  minQuestions: number;
  active: boolean;
  /** In asking-preference order. */
  questions: ProfileQuestion[];
}

export const PROFILE_ID_RE = /^[a-z0-9-]{2,40}$/;
export const MAX_MIN_QUESTIONS = 12;

export function isProfileId(v: unknown): v is string {
  return typeof v === "string" && PROFILE_ID_RE.test(v);
}

const idx = (r: CefrRung) => CEFR_LADDER.indexOf(r);

/** 0 when `rung` is inside the question's range, else how many levels away it is. */
export function rungDistance(rung: CefrRung, q: Pick<ProfileQuestion, "minLevel" | "maxLevel">): number {
  const i = idx(rung);
  if (i < idx(q.minLevel)) return idx(q.minLevel) - i;
  if (i > idx(q.maxLevel)) return i - idx(q.maxLevel);
  return 0;
}

/** How many of the profile's required questions are still to ask. */
export function profileRemaining(profile: TestProfile, askedIds: string[]): number {
  return Math.max(0, profile.minQuestions - askedIds.length);
}

/**
 * The profile question to ask this turn, or null to use the standard bank.
 * - Nothing once `minQuestions` have been asked.
 * - Not two turns in a row (`lastWasProfile`), so they are spread over the
 *   conversation — unless `urgent`.
 * - In range first, in the profile's order; when `urgent` and none is in
 *   range, the closest range (then the profile's order).
 */
export function pickProfileQuestion(params: {
  profile: TestProfile;
  rung: CefrRung;
  askedIds: string[];
  lastWasProfile: boolean;
  urgent: boolean;
}): (ProfileQuestion & { id: string }) | null {
  const { profile, rung, askedIds, lastWasProfile, urgent } = params;
  if (profileRemaining(profile, askedIds) === 0) return null;
  if (lastWasProfile && !urgent) return null;
  const open = profile.questions.filter((q): q is ProfileQuestion & { id: string } => !!q.id && q.active && !askedIds.includes(q.id));
  const inRange = open.find((q) => rungDistance(rung, q) === 0);
  if (inRange) return inRange;
  if (!urgent || !open.length) return null;
  return [...open].sort((a, b) => rungDistance(rung, a) - rungDistance(rung, b))[0];
}

/** Validates an editor payload; throws a message an admin can read. */
export function parseProfileInput(body: unknown, id: string): TestProfile {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!isProfileId(id)) throw new Error("Identifiant : 2 à 40 caractères, minuscules, chiffres et tirets.");
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) throw new Error("Le nom est obligatoire.");
  if (!isProfileLanguage(b.language)) throw new Error("Langue inconnue.");
  const minQuestions = Number(b.minQuestions);
  if (!Number.isInteger(minQuestions) || minQuestions < 0 || minQuestions > MAX_MIN_QUESTIONS)
    throw new Error(`Nombre minimum de questions : un entier de 0 à ${MAX_MIN_QUESTIONS}.`);
  const rawQuestions = Array.isArray(b.questions) ? b.questions : [];
  const questions: ProfileQuestion[] = rawQuestions.map((raw, i) => {
    const q = (raw ?? {}) as Record<string, unknown>;
    const text = typeof q.text === "string" ? q.text.trim() : "";
    if (!text) throw new Error(`Question ${i + 1} : le texte est vide.`);
    if (!isCefrRung(q.minLevel) || !isCefrRung(q.maxLevel)) throw new Error(`Question ${i + 1} : niveaux invalides.`);
    if (idx(q.minLevel) > idx(q.maxLevel)) throw new Error(`Question ${i + 1} : le niveau minimum dépasse le maximum.`);
    const simpler = typeof q.simpler === "string" && q.simpler.trim() ? q.simpler.trim() : null;
    return {
      ...(typeof q.id === "string" && q.id ? { id: q.id } : {}),
      text,
      simpler,
      minLevel: q.minLevel,
      maxLevel: q.maxLevel,
      active: q.active !== false,
    };
  });
  const activeCount = questions.filter((q) => q.active).length;
  if (minQuestions > activeCount) throw new Error(`Minimum de ${minQuestions} questions, mais seulement ${activeCount} active(s).`);
  return { id, name, language: b.language, minQuestions, active: b.active !== false, questions };
}
