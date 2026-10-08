/**
 * Curated question bank (Track AA), one file per rung, every entry written in
 * all 6 session languages instead of being translated by the examiner model
 * on the fly.
 *
 * How each rung uses it (see lib/examiner-prompt.ts):
 *   warmup  the opening question of every session, whatever the starting rung.
 *   A2–B2   a slice of the rung's bank is shown to the examiner, which picks
 *           from it (and may ask its own follow-ups) — see buildQuestionBank
 *           in lib/conversation-prompts.ts.
 *   A1      the code picks the question and its one fixed short follow-up
 *           (Track AF-03): short closed/choice questions a beginner can catch.
 *   C1/C2   the code picks the question (pickBankQuestion) and the examiner
 *           asks it, then ONE follow-up from its pre-written followUps, then
 *           the next bank question. Free-writing at these rungs produced
 *           DELF/DALF-style debate questions testers couldn't answer.
 *
 * Content is reviewed by the client on /admin/question-bank.
 */

import type { CefrRung } from "@/lib/cefr-rung";
import type { TopicDomain } from "@/lib/topic-domain";
import type { BankEntry, BankQuestion, BankRung } from "@/lib/question-bank/types";
import { WARMUP } from "@/lib/question-bank/warmup";
import { A1 } from "@/lib/question-bank/a1";
import { A2 } from "@/lib/question-bank/a2";
import { B1 } from "@/lib/question-bank/b1";
import { B2 } from "@/lib/question-bank/b2";
import { C1 } from "@/lib/question-bank/c1";
import { C2 } from "@/lib/question-bank/c2";

export type { BankQuestion, BankRung, L10n } from "@/lib/question-bank/types";

const withRung = (rung: BankRung, entries: BankEntry[]): BankQuestion[] => entries.map((e) => ({ ...e, rung }));

export const BANK_RUNGS: BankRung[] = ["warmup", "A1", "A2", "B1", "B2", "C1", "C2"];

const BANK: Record<BankRung, BankQuestion[]> = {
  warmup: withRung("warmup", WARMUP),
  A1: withRung("A1", A1),
  A2: withRung("A2", A2),
  B1: withRung("B1", B1),
  B2: withRung("B2", B2),
  C1: withRung("C1", C1),
  C2: withRung("C2", C2),
};

const BY_ID = new Map(BANK_RUNGS.flatMap((r) => BANK[r]).map((q) => [q.id, q]));

export function bankFor(rung: BankRung): BankQuestion[] {
  return BANK[rung];
}

export function questionById(id: string | undefined): BankQuestion | undefined {
  return id ? BY_ID.get(id) : undefined;
}

function randomOf<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Picks the next question of `rung`'s bank not yet used this session. Domain
 * preference, in order: `preferDomain` (the topic switch target), then a
 * domain this rung hasn't asked about yet (never `avoidDomain`), then anything
 * but `avoidDomain`. Once the rung's pool is exhausted it cycles: that rung's
 * ids are dropped from usedIds (other rungs untouched), same rule as the A1–B2
 * slices in buildQuestionBank.
 */
export function pickBankQuestion(params: {
  rung: BankRung;
  usedIds: string[];
  preferDomain?: TopicDomain;
  avoidDomain?: TopicDomain;
}): { question: BankQuestion; updatedUsedIds: string[] } {
  const bank = BANK[params.rung];
  let used = params.usedIds;
  let pool = bank.filter((q) => !used.includes(q.id));
  if (pool.length === 0) {
    used = used.filter((id) => !bank.some((q) => q.id === id));
    pool = bank;
  }
  const askedDomains = new Set(bank.filter((q) => used.includes(q.id)).map((q) => q.domain));
  const candidates = [
    pool.filter((q) => q.domain === params.preferDomain),
    pool.filter((q) => q.domain !== params.avoidDomain && !askedDomains.has(q.domain)),
    pool.filter((q) => q.domain !== params.avoidDomain),
    pool,
  ].find((c) => c.length > 0)!;
  const question = randomOf(candidates);
  return { question, updatedUsedIds: [...used, question.id] };
}

/** Rungs where the code, not the examiner, picks the question: A1 (so the model can't make a beginner's question harder) and C1/C2 (no DELF/DALF-style free writing). */
export function isCodePickedRung(rung: CefrRung): rung is "A1" | "C1" | "C2" {
  return rung === "A1" || rung === "C1" || rung === "C2";
}
