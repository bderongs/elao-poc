import type { ConvLang } from "@/lib/conversation-prompts";
import type { CefrRung } from "@/lib/cefr-rung";
import type { TopicDomain } from "@/lib/topic-domain";

/** One string per session language — Record<ConvLang,…> makes a missing language a compile error. */
export type L10n = Record<ConvLang, string>;

/** "warmup" = the session's opening question, asked whatever the starting rung (Track AA-01). */
export type BankRung = CefrRung | "warmup";

export interface BankEntry {
  /** Stable id (e.g. "c1-work-01") — what usedQuestions tracks, so wording can change without breaking it. */
  id: string;
  domain: TopicDomain;
  text: L10n;
  /** Pre-written easier re-ask, used when the speaker says they didn't understand (C1/C2 bank turns). */
  simpler?: L10n;
  /** Pre-written follow-ups, offered on the C1/C2 turn after this question. */
  followUps?: L10n[];
}

export interface BankQuestion extends BankEntry {
  rung: BankRung;
}
