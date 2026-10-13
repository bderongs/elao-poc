/**
 * Post-check on an examiner reply, before its question is spoken — shared by
 * the live conversation (app/api/chat/route.ts) and the simulator
 * (lib/conversation-sim.ts). Two failures the prompt alone doesn't prevent
 * (sim-runs/matrix-2026-10-12T15-55-27, 746 turns):
 *
 * - no question: the reply is only a pivot or bridge ("Got it.", "Laten we
 *   iets anders bespreken.") — the speaker is left with nothing to answer.
 * - repeat: the same question again, (nearly) word for word — mostly a
 *   "didn't understand" re-ask that wasn't made simpler, up to 3 times running.
 *
 * Either one gets ONE corrective regeneration. Live, the reply streams to TTS
 * sentence by sentence, but its last sentence (normally the question) is only
 * fired once the stream ends — so a repeated question can still be swapped
 * out, and a missing one appended after the pivot already spoken.
 */

import { BRIDGE_PHRASES, PIVOT_WORDS, type ConvLang } from "@/lib/conversation-prompts";

/**
 * A complete sentence at the start of the not-yet-spoken text — the boundary
 * app/api/chat/route.ts fires TTS on. At least 2 consecutive letters before the
 * terminator, so a stray "1." isn't a sentence of its own.
 */
export const SPOKEN_SENTENCE_RE = /^([\s\S]*?[A-Za-zÀ-ÖØ-öø-ÿ]{2}[\s\S]*?[.!?…])\s/;

/** What's left unspoken at the end of the stream: everything after the last fired sentence. */
export function unspokenTail(text: string): string {
  let pending = text;
  let m;
  while ((m = pending.match(SPOKEN_SENTENCE_RE))) pending = pending.slice(m[0].length);
  return pending;
}

const norm = (s: string) =>
  ` ${s.toLowerCase().normalize("NFC").replace(/[^\p{L}\p{N}' ]+/gu, " ").replace(/\s+/g, " ").trim()} `;

const phrases = (list: string) => [...list.matchAll(/"([^"]+)"/g)].map((m) => norm(m[1]).trim()).filter(Boolean);

/** Only pivots / bridges, nothing to answer. */
function isPivotOnly(language: ConvLang, text: string): boolean {
  let rest = norm(text);
  for (const p of [...phrases(BRIDGE_PHRASES[language]), ...phrases(PIVOT_WORDS[language])].sort((a, b) => b.length - a.length)) {
    rest = rest.split(` ${p} `).join(" ");
  }
  return !/\p{L}/u.test(rest);
}

/** The question in an examiner turn: its last sentence with a "?", else its last sentence. */
function questionOf(text: string): string {
  const sentences = text.split(/(?<=[.!?…])\s+/).map((s) => s.trim()).filter(Boolean);
  return [...sentences].reverse().find((s) => s.includes("?")) ?? sentences[sentences.length - 1] ?? "";
}

/** Word-set overlap of two questions (Jaccard); short questions ("Warum?") never count as repeats. */
function sameQuestion(a: string, b: string): boolean {
  const wa = new Set(norm(questionOf(a)).trim().split(" ").filter(Boolean));
  const wb = new Set(norm(questionOf(b)).trim().split(" ").filter(Boolean));
  if (wa.size < 3 || wb.size < 3) return false;
  const inter = [...wa].filter((w) => wb.has(w)).length;
  return inter / (wa.size + wb.size - inter) >= 0.75;
}

export type ReplyProblem = { kind: "no_question" } | { kind: "repeat"; askedBefore: 1 | 2 };

/** null = the reply is fine. `previousExaminerTurns` oldest first. Never call on the closing turn. */
export function checkExaminerReply(language: ConvLang, reply: string, previousExaminerTurns: string[]): ReplyProblem | null {
  if (!reply.trim()) return null;
  if (isPivotOnly(language, reply)) return { kind: "no_question" };
  const [beforeLast, last] = previousExaminerTurns.slice(-2).length === 2 ? previousExaminerTurns.slice(-2) : [undefined, previousExaminerTurns.at(-1)];
  if (last && sameQuestion(reply, last)) return { kind: "repeat", askedBefore: beforeLast && sameQuestion(last, beforeLast) ? 2 : 1 };
  return null;
}

const NOTE = "\n[INTERNAL DIRECTION — never say, quote or translate this note aloud; it is not part of the conversation] ";

/** Appended to the turn's system prompt for the corrective regeneration. */
export function retryDirection(problem: ReplyProblem): string {
  if (problem.kind === "no_question") {
    return `${NOTE}Your reply had no question in it — the speaker has nothing to answer. Reply now with ONLY the question for this turn: no pivot word, no bridge, no comment.`;
  }
  if (problem.askedBefore === 2) {
    return `${NOTE}You have already asked this question twice and were about to ask it a third time. Drop that subject for good. Reply with ONLY one new, very easy question about something concrete and familiar on a different subject, at the target difficulty or easier — no pivot word, no bridge, no comment.`;
  }
  return `${NOTE}You were about to ask your last question again in almost the same words. If the speaker did not understand it, ask the same thing in clearly different, simpler words — shorter, the most common everyday words, or an easy choice ("X or Y?"); otherwise ask the next question. Reply with ONLY that question — no pivot word, no bridge, no comment.`;
}

/** Drop pivots/bridges the regeneration may still open with, since one may already have been spoken. */
function stripLeadingPivots(language: ConvLang, text: string): string {
  const starts = [...phrases(BRIDGE_PHRASES[language]), ...phrases(PIVOT_WORDS[language])].sort((a, b) => b.length - a.length);
  let out = text.trim();
  for (let changed = true; changed; ) {
    changed = false;
    const head = norm(out).trim();
    for (const p of starts) {
      if (head.startsWith(p + " ") || head === p) {
        // Cut the same number of words (plus their punctuation) from the original text.
        const n = p.split(" ").length;
        out = out.split(/\s+/).slice(n).join(" ").replace(/^[,:;—–-]\s*/, "").trim();
        changed = true;
        break;
      }
    }
  }
  return out ? out.charAt(0).toLocaleUpperCase() + out.slice(1) : out;
}

/**
 * Check a finished reply and repair it with one regeneration. `fullText` is the whole reply,
 * `pending` its unspoken tail (see unspokenTail). Returns the corrected pair, or null when the
 * reply is fine or can't be repaired (the repeated question was already spoken, or the
 * regeneration failed or came back empty).
 */
export async function repairExaminerReply(params: {
  language: ConvLang;
  fullText: string;
  pending: string;
  previousExaminerTurns: string[];
  regenerate: (direction: string) => Promise<string>;
}): Promise<{ fullText: string; pending: string; problem: ReplyProblem } | null> {
  const { language, fullText, pending, previousExaminerTurns } = params;
  const problem = checkExaminerReply(language, fullText, previousExaminerTurns);
  if (!problem) return null;
  // A repeated question can only be swapped while it is still unspoken.
  if (problem.kind === "repeat" && !pending.includes("?")) return null;
  let question: string;
  try {
    question = stripLeadingPivots(language, await params.regenerate(retryDirection(problem)));
    // The regeneration sometimes repeats the question anyway — then drop the subject instead.
    if (checkExaminerReply(language, question, previousExaminerTurns)?.kind === "repeat") {
      question = stripLeadingPivots(language, await params.regenerate(retryDirection({ kind: "repeat", askedBefore: 2 })));
    }
  } catch {
    return null;
  }
  if (!/\p{L}/u.test(question)) return null;
  if (problem.kind === "no_question") {
    const joined = pending.trim() ? `${pending.trimEnd()} ${question}` : question;
    return { fullText: `${fullText.trimEnd()} ${question}`, pending: joined, problem };
  }
  const spoken = fullText.slice(0, fullText.length - pending.length);
  return { fullText: `${spoken}${question}`, pending: question, problem };
}
