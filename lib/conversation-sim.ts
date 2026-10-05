/**
 * Conversation simulator — admin testing tool (app/admin/(dashboard)/simulator).
 * Plays a full text-only session: an LLM "learner" persona at a chosen CEFR
 * level answers the real examiner, then the real end-of-session CEFR
 * evaluation scores the learner's turns.
 *
 * Everything except the learner reuses the live pipeline's own pieces —
 * buildExaminerPrompt (same as app/api/chat/route.ts, minus TTS), ET
 * (lib/et/registry.ts), TT (lib/topic-tracking.ts), CEFR_SYSTEM_PROMPT (same
 * as app/api/evaluate/route.ts) — and mirrors app/page.tsx's orchestration
 * (rung stepping, domain streak → avoidDomain/switchToDomain, __START__/__END__).
 *
 * Deliberate differences from a live session:
 * - ET and TT are awaited before the next examiner turn, so the rung and
 *   topic state are never stale (live they're best-effort/non-blocking).
 * - No audio: no pronunciation or WPM, so the evaluation runs without
 *   pronunciationContext — the fluency dimension is judged from text alone.
 * - Session length is a fixed number of learner answers, not a 3-min timer.
 *
 * At A1/A2 the learner never reads the examiner's text directly: a separate
 * "listening" call first reduces each examiner turn to what a learner of that
 * level would actually catch (unknown parts → "…"), and the learner answers
 * from that. Prompting alone doesn't work — an LLM that has read the full
 * question can't convincingly pretend not to understand it.
 */

import type { ConvLang } from "@/lib/conversation-prompts";
import { guardStepUp, type CefrRung } from "@/lib/cefr-rung";
import type { CefrResult } from "@/lib/types";
import { buildExaminerPrompt, type BankState } from "@/lib/examiner-prompt";
import { mistralChatModel, mistralComplete } from "@/lib/mistral";
import { getProvider as getEtProvider, LIVE_ET_PROVIDER_ID } from "@/lib/et/registry";
import { classifyTopicDomain } from "@/lib/topic-tracking";
import { isNonComprehension } from "@/lib/comprehension";
import { pickSwitchDomain, type TopicDomain } from "@/lib/topic-domain";
import { getProvider as getLlmProvider } from "@/lib/llm/registry";
import type { LlmProvider } from "@/lib/llm/types";
import { LIVE_CONVERSATION_MODEL_ID } from "@/lib/llm/live-provider";
import { CEFR_SYSTEM_PROMPT, buildEvaluationUserMessage, parseCefrEvaluation } from "@/lib/cefr-prompt";
import { computeCompositeCefrScore, type CompositeCefrScore } from "@/lib/cefr-score";

/** Mirrors app/page.tsx's MAX_DOMAIN_STREAK. */
const MAX_DOMAIN_STREAK = 2;

const LANGUAGE_NAME: Record<ConvLang, string> = {
  fr: "French",
  en: "English",
  "nl-BE": "Dutch (Belgian)",
  es: "Spanish",
  it: "Italian",
  de: "German",
};

export interface SimPersona {
  name: string;
  age: number;
  job: string;
  city: string;
  family: string;
  hobbies: string;
  nativeLanguage: string;
}

export interface SimConfig {
  language: ConvLang;
  learnerLevel: CefrRung;
  startingRung: CefrRung;
  stepSize: number;
  answers: number;
  /** lib/llm/registry.ts provider playing the learner. Mistral by default;
   *  Anthropic gives a learner from a different vendor than the Mistral
   *  examiner/scorer, so it doesn't share their blind spots. */
  learnerProvider: "anthropic" | "mistral";
}

export type SimEvent =
  | { type: "start"; config: SimConfig; persona: SimPersona; learnerModel: string; examinerModel: string }
  | {
      type: "examiner";
      turn: number;
      text: string;
      rung: CefrRung;
      closing: boolean;
      avoidDomain?: TopicDomain;
      switchToDomain?: TopicDomain;
    }
  | { type: "topic"; turn: number; domain: TopicDomain | null; streak: number }
  | { type: "learner"; turn: number; text: string; heard?: string; understanding?: Understanding }
  | { type: "et"; turn: number; verdict: string; previousRung: CefrRung; nextRung: CefrRung }
  | { type: "evaluation"; result: CefrResult; composite: CompositeCefrScore }
  | { type: "error"; stage: string; message: string }
  | { type: "done"; durationMs: number };

// ─── Learner persona ─────────────────────────────────────────────────────────

const PROFILES: Omit<SimPersona, "nativeLanguage">[] = [
  { name: "Sarah", age: 34, job: "nurse in a hospital", city: "Liège", family: "married, two young sons", hobbies: "running and cooking" },
  { name: "Thomas", age: 27, job: "junior accountant", city: "Namur", family: "lives with his girlfriend, one older sister", hobbies: "football and video games" },
  { name: "Aïcha", age: 41, job: "primary school teacher", city: "Brussels", family: "divorced, one teenage daughter", hobbies: "reading and gardening" },
  { name: "Pieter", age: 52, job: "logistics manager", city: "Antwerp", family: "married, three adult children", hobbies: "cycling and jazz" },
  { name: "Laura", age: 23, job: "master's student in marketing", city: "Leuven", family: "lives with her parents and a dog", hobbies: "photography and travelling" },
  { name: "Marc", age: 38, job: "software developer", city: "Charleroi", family: "single, close to his brother", hobbies: "climbing and board games" },
];

/** Hard constraints per level — LLMs left to "act A1" drift up to B1 fast, so these are explicit. */
const LEVEL_GUIDE: Record<CefrRung, string> = {
  A1: `- Answers of 1 to 8 words. Often fragments, not full sentences.
- Present tense only. Very basic, concrete vocabulary (family, food, numbers, city).
- Frequent errors: wrong verb forms, missing or wrong articles/gender, word order mistakes.
- Sometimes drop a word from your native language when you don't know it.`,
  A2: `- Answers of 5 to 20 words. Simple sentences joined with "and", "but", "because".
- Mostly present tense; attempts at past tense with frequent mistakes.
- Limited vocabulary, repetitions, basic errors that don't block meaning.
- Abstract or hypothetical questions: you give a very short, simple answer or bring it back to your own concrete life.`,
  B1: `- Answers of 20 to 45 words. Connected sentences, you can describe experiences and give simple reasons.
- Past and future tenses mostly correct; errors appear in more complex structures.
- You sometimes search for words, rephrase, or use a simpler word instead.
- Abstract questions: you give a basic opinion with a simple justification, without much nuance.`,
  B2: `- Answers of 35 to 70 words. Clear, detailed, you argue a viewpoint with pros and cons.
- Good grammatical control; occasional errors, sometimes self-corrected.
- Fairly wide vocabulary, some repetition on less familiar topics.`,
  C1: `- Answers of 50 to 90 words. Fluent, well-structured, uses complex sentences and linking words naturally.
- Idiomatic expressions, precise vocabulary. Rare slips only.
- Handles abstract and hypothetical questions with ease and nuance.`,
  C2: `- Answers of 50 to 100 words. Near-native: effortless, nuanced, precise.
- Rich, idiomatic vocabulary, subtle distinctions, varied structures. Practically no errors.`,
};

// ─── Listening comprehension (A1/A2) ─────────────────────────────────────────

export type Understanding = "full" | "partial" | "none";

/** What a listener at each level catches in spoken speech. B1+ understand the examiner directly. */
const LISTENING_GUIDE: Partial<Record<CefrRung, string>> = {
  A1: `- Knows only very frequent, concrete words: greetings, name, age, family members, numbers, days, food, colours, home, city, work, school, "like / live / have / be / do / go" in the present tense, basic question words (what, where, who, how old, how many).
- Understands a question only if it is short (about 8 words or fewer), slow, in the present tense, and about something concrete and personal.
- Does NOT understand: future, conditional, past or subjunctive forms, subordinate clauses, formal or administrative wording, abstract or less common words (e.g. "evaluate", "level", "approximately", "favourite pastimes", "experience", "opinion").
- In a long, multi-sentence turn, only isolated familiar words come through; the meaning of the whole is lost.`,
  A2: `- Understands short, simple sentences about familiar everyday topics (family, work, shopping, home, free time, daily routine, recent simple events), in present, simple past and near future.
- Loses the thread in long sentences, several chained questions, formal wording, or less common vocabulary.
- Does NOT understand abstract, hypothetical or opinion questions phrased in complex language (conditional, subjunctive, "to what extent", "in your view", etc.) — catches only the concrete key words.`,
};

function listenerSystemPrompt(language: ConvLang, level: CefrRung, guide: string): string {
  const lang = LANGUAGE_NAME[language];
  return `You simulate the LISTENING comprehension of a ${lang} learner at CEFR ${level}, hearing an examiner speak ${lang} at natural speed.

WHAT THIS LEARNER UNDERSTANDS:
${guide}

Given the examiner's words, output what this learner actually catches:
- "heard": the examiner's text with every word or phrase this learner would NOT understand replaced by "…" (merge consecutive gaps into one "…"). Keep the words they do catch, unchanged and in order. Keep the final "?" if there is a question. Do not translate or explain.
- "understanding": "full" if they get the whole meaning of the question, "partial" if they get some key words but are unsure what is asked, "none" if they cannot tell what is being asked.

Be strict — err on the side of NOT understanding. Real learners at this level miss much more than a text-reading AI would expect.

Reply with JSON only: {"understanding": "full" | "partial" | "none", "heard": "..."}`;
}

/** Reduces one examiner turn to what the learner catches. Falls back to the full text on any failure. */
async function perceiveExaminerTurn(
  learner: LlmProvider,
  language: ConvLang,
  level: CefrRung,
  examinerText: string,
  context: string,
): Promise<{ heard: string; understanding: Understanding } | null> {
  const guide = LISTENING_GUIDE[level];
  if (!guide) return null;
  try {
    const raw = await learner.complete({
      system: listenerSystemPrompt(language, level, guide),
      messages: [{ role: "user", content: examinerText }],
      maxTokens: 300,
      json: true,
      context,
    });
    const parsed = JSON.parse(raw.replace(/^```json\s*|\s*```$/g, "").trim()) as { heard?: unknown; understanding?: unknown };
    const understanding: Understanding =
      parsed.understanding === "full" || parsed.understanding === "partial" || parsed.understanding === "none"
        ? parsed.understanding
        : "partial";
    const heard = typeof parsed.heard === "string" && parsed.heard.trim() ? parsed.heard.trim() : "…";
    return { heard, understanding };
  } catch {
    return { heard: examinerText, understanding: "full" };
  }
}

/** How a perceived examiner turn is shown to the learner model. */
function formatHeard(p: { heard: string; understanding: Understanding }): string {
  return `[What you caught — understanding: ${p.understanding}]\n${p.heard}`;
}

export function pickPersona(language: ConvLang): SimPersona {
  const profile = PROFILES[Math.floor(Math.random() * PROFILES.length)];
  return { ...profile, nativeLanguage: language === "fr" ? "Dutch" : "French" };
}

function learnerSystemPrompt(language: ConvLang, level: CefrRung, p: SimPersona): string {
  const lang = LANGUAGE_NAME[language];
  return `You are role-playing a language learner in a short spoken ${lang} oral exam. Another AI plays the examiner; you only play the learner.

WHO YOU ARE:
${p.name}, ${p.age}, ${p.job}, lives in ${p.city}. Family: ${p.family}. Hobbies: ${p.hobbies}. Native language: ${p.nativeLanguage}.
Invent further personal details as needed, but stay consistent with what you've already said.

YOUR ${lang.toUpperCase()} LEVEL IS CEFR ${level}. This is the most important rule — stay strictly at this level for the whole conversation, even when the examiner asks harder questions:
${LEVEL_GUIDE[level]}

FORMAT:
- Reply ONLY with what you say out loud, in ${lang} (apart from the occasional native-language slip allowed above). No stage directions, no quotes, no translations, no notes.
- This is a speech-to-text transcript of you speaking: plain text, simple punctuation, occasional fillers or hesitations fitting your level.
- Answer the examiner's question like a real candidate would — don't ask the examiner questions back, don't comment on the exam itself.${
    LISTENING_GUIDE[level]
      ? `

LISTENING:
You do not see what the examiner really said, only what you managed to catch. Each examiner message is labelled with how much you understood; "…" marks parts you did not understand at all. You have no idea what was in the "…" — never guess it from context you don't have.
- understanding "none": do not answer. Say you don't understand, or ask them to repeat or speak slowly — in simple ${lang} fitting your level (broken forms are fine), possibly with a native-language word.
- understanding "partial": either ask for repetition, or take a guess from the words you caught and answer that — even if it may be the wrong question.
- understanding "full": answer normally, at your level.
Asking for repetition is the one exception to "don't ask the examiner questions back".`
      : ""
  }`;
}

// ─── Simulation loop ─────────────────────────────────────────────────────────

type Msg = { role: "user" | "assistant"; content: string };

export async function* runConversationSimulation(
  config: SimConfig,
  signal?: AbortSignal,
): AsyncGenerator<SimEvent> {
  const startedAt = Date.now();
  const { language, learnerLevel, stepSize, answers } = config;
  const persona = pickPersona(language);
  const learner = getLlmProvider(config.learnerProvider);
  const learnerSystem = learnerSystemPrompt(language, learnerLevel, persona);
  const runId = `sim-${startedAt}`;

  yield { type: "start", config, persona, learnerModel: learner.modelLabel, examinerModel: mistralChatModel() };

  // Examiner-perspective history, same shape as app/page.tsx's historyRef:
  // examiner = "assistant", learner = "user".
  const history: Msg[] = [];
  // Learner-perspective history: examiner = "user", learner = "assistant", and
  // at A1/A2 examiner turns are replaced by what the learner caught.
  const learnerView: Msg[] = [];
  let rung: CefrRung = config.startingRung;
  let lastVerdict: string | undefined;
  let usedQuestions: string[] = [];
  let bankState: BankState = {};
  let currentDomain: TopicDomain | null = null;
  let domainStreak = 0;
  const visitedDomains: TopicDomain[] = [];

  /** One examiner turn — same inputs app/page.tsx sends to /api/chat. */
  const examinerTurn = async (turn: number, requestHistory: Msg[], userMessage: string, isStart: boolean, clarify = false) => {
    const avoidDomain = !isStart && !clarify && domainStreak >= MAX_DOMAIN_STREAK ? currentDomain ?? undefined : undefined;
    const switchToDomain = avoidDomain ? pickSwitchDomain(avoidDomain, visitedDomains) : undefined;
    const { system, targetRung, updatedUsedQuestions, bankState: updatedBankState } = buildExaminerPrompt({
      language, rung, usedQuestions, bankState, isStart, isEnd: userMessage === "__END__", avoidDomain, switchToDomain, clarify,
    });
    const text = await mistralComplete({
      model: mistralChatModel(),
      system,
      messages: [...requestHistory, { role: "user", content: userMessage }],
      maxTokens: 300,
      context: `${runId}:examiner-${turn}`,
    });
    usedQuestions = updatedUsedQuestions;
    bankState = updatedBankState;
    return { text: text.trim(), targetRung, avoidDomain, switchToDomain };
  };

  /** TT — mirrors app/page.tsx's runTopicClassification. */
  const classify = async (turn: number, question: string, recentExchange: string): Promise<SimEvent> => {
    const domain = await classifyTopicDomain({
      questionAsked: question,
      recentExchange: recentExchange || undefined,
      turnLogId: `${runId}-${turn}`,
      process: `${runId}:TT${turn}`,
    });
    if (domain) {
      domainStreak = domain === currentDomain ? domainStreak + 1 : 1;
      currentDomain = domain;
      if (!visitedDomains.includes(domain)) visitedDomains.push(domain);
    }
    return { type: "topic", turn, domain, streak: domainStreak };
  };

  try {
    // Opening turn — same synthetic user message app/page.tsx sends for "__START__".
    const openingMessage = language === "fr" ? "Bonjour, démarrons la conversation." : "Hello, let's start the conversation.";
    const opening = await examinerTurn(0, [], openingMessage, true);
    history.push({ role: "assistant", content: opening.text });
    yield { type: "examiner", turn: 0, text: opening.text, rung: opening.targetRung, closing: false };
    yield await classify(0, opening.text, "");

    for (let turn = 1; turn <= answers; turn++) {
      if (signal?.aborted) return;
      const question = history[history.length - 1].content;

      const perceived = await perceiveExaminerTurn(learner, language, learnerLevel, question, `${runId}:listen-${turn}`);
      learnerView.push({ role: "user", content: perceived ? formatHeard(perceived) : question });
      const answer = (
        await learner.complete({
          system: learnerSystem,
          messages: learnerView,
          maxTokens: 400,
          context: `${runId}:learner-${turn}`,
        })
      ).trim();
      learnerView.push({ role: "assistant", content: answer });
      yield {
        type: "learner",
        turn,
        text: answer,
        ...(perceived ? { heard: perceived.heard, understanding: perceived.understanding } : {}),
      };

      // ET — awaited here (non-blocking live, see header comment).
      const previousRung = rung;
      const et = await getEtProvider(LIVE_ET_PROVIDER_ID).assess({
        language, questionAsked: question, userAnswer: answer, currentRung: rung, turnLogId: `${runId}-${turn}`, stepSize,
      });
      if (et) {
        rung = guardStepUp(rung, et.nextRung, lastVerdict);
        lastVerdict = et.verdict;
      }
      yield { type: "et", turn, verdict: et?.verdict ?? "unavailable", previousRung, nextRung: rung };

      // app/page.tsx sends the answer both inside `history` and as
      // `userMessage` — mirrored as-is so the examiner sees what it sees live.
      const newHistory: Msg[] = [...history, { role: "user", content: answer }];
      const isLast = turn === answers;
      // Live (app/page.tsx): a spoken "je ne comprends pas"-style answer makes the examiner
      // re-ask the same question more simply instead of moving on (lib/comprehension.ts).
      const clarify = !isLast && isNonComprehension(answer);
      const reply = await examinerTurn(turn, newHistory, isLast ? "__END__" : answer, false, clarify);
      history.push({ role: "user", content: answer }, { role: "assistant", content: reply.text });
      yield {
        type: "examiner",
        turn,
        text: reply.text,
        rung: reply.targetRung,
        closing: isLast,
        ...(reply.avoidDomain ? { avoidDomain: reply.avoidDomain } : {}),
        ...(reply.switchToDomain ? { switchToDomain: reply.switchToDomain } : {}),
      };
      // A clarify re-ask is the same question again — not classified, like live.
      if (!isLast && !clarify) {
        const recentExchange = newHistory.slice(-2).map((m) => `${m.role}: ${m.content}`).join("\n");
        yield await classify(turn, reply.text, recentExchange);
      }
    }
  } catch (e) {
    yield { type: "error", stage: "conversation", message: String(e) };
    yield { type: "done", durationMs: Date.now() - startedAt };
    return;
  }

  // End-of-session CEFR evaluation — same call as app/api/evaluate/route.ts, text only.
  try {
    const userTurns = history.filter((m) => m.role === "user").map((m) => m.content);
    const provider = getLlmProvider(LIVE_CONVERSATION_MODEL_ID);
    const raw = await provider.complete({
      model: provider.modelLabel,
      system: CEFR_SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildEvaluationUserMessage(language, userTurns) }],
      maxTokens: 1500,
      json: true,
      context: `${runId}:cefr-eval`,
    });
    const result = parseCefrEvaluation(raw);
    yield { type: "evaluation", result, composite: computeCompositeCefrScore(result, null) };
  } catch (e) {
    yield { type: "error", stage: "evaluation", message: String(e) };
  }

  yield { type: "done", durationMs: Date.now() - startedAt };
}
