/**
 * The examiner's (Léa's) prompt, built per turn in three layers — core rules,
 * the rules of this kind of turn, and the turn note appended to the speaker's
 * message (see buildTurnPrompt and doc/examiner-prompt-audit-2026-11-17.md).
 *
 * buildQuestionBank() narrows the A1–B2 bank shown each turn to the caller's
 * target rung only (lib/examiner-prompt.ts calls it once per turn, using the
 * rung ET — lib/level-assessment.ts — most recently judged) and tracks which
 * bank ids have already been offered this session (usedQuestions, threaded in
 * from the client) so the same question doesn't resurface until that rung's
 * pool has cycled once. C1/C2 questions are picked in code instead (see
 * lib/question-bank/index.ts).
 */

import { zoneForRung, type CefrRung } from "@/lib/cefr-rung";
import { AVATAR_NAME, SESSION_DURATION_MINUTES as MIN, SESSION_LENGTH_MODE } from "@/lib/session-config";

// How the opening line announces the session length: a fixed duration, or —
// when the length is adaptive (lib/session-length.ts) — no number at all.
const ADAPTIVE_LENGTH = SESSION_LENGTH_MODE === "adaptive";
const DURATION_PHRASE = {
  fr: ADAPTIVE_LENGTH ? "quelques minutes" : `environ ${MIN} minutes`,
  "nl-BE": ADAPTIVE_LENGTH ? "enkele minuten" : `ongeveer ${MIN} minuten`,
  "nl-NL": ADAPTIVE_LENGTH ? "enkele minuten" : `ongeveer ${MIN} minuten`,
  es: ADAPTIVE_LENGTH ? "unos minutos" : `unos ${MIN} minutos`,
  it: ADAPTIVE_LENGTH ? "qualche minuto" : `circa ${MIN} minuti`,
  de: ADAPTIVE_LENGTH ? "einige Minuten" : `etwa ${MIN} Minuten`,
  en: ADAPTIVE_LENGTH ? "a few minutes" : `about ${MIN} minutes`,
};

// Client-imposed intro sentence (roadmap Q-04, 2026-11-12): said word for word
// instead of the model's own wording of the length/purpose line.
const NL_INTRO = "Deze conversatie duurt enkele minuten en helpt ons om uw Nederlands te evalueren.";
const FIXED_INTRO_SENTENCE: Partial<Record<ConvLang, string>> = {
  "nl-BE": NL_INTRO,
  "nl-NL": NL_INTRO,
};
import { DOMAIN_LABEL, SWITCH_SEEDS, type TopicDomain } from "@/lib/topic-domain";
import { bankFor } from "@/lib/question-bank";

// ─── Question bank slice (A1–B2) ─────────────────────────────────────────────

// The bank itself lives in lib/question-bank/ (one file per rung, every entry
// written in all 6 languages). A1–B2 show the examiner a shuffled slice of the
// target rung's entries to pick from; C1/C2 don't go through here at all —
// lib/examiner-prompt.ts picks the exact question in code (Track AA).
const SLICE_BY_RUNG: Record<"A1" | "A2" | "B1" | "B2", { label: string; sliceSize: number }> = {
  A1: { label: "A1 rung — very simple, one concept at a time, short answers fine", sliceSize: 4 },
  A2: { label: "A2 rung — simple sentences, familiar topics", sliceSize: 5 },
  B1: { label: "B1 rung — descriptions, simple opinions, past/future", sliceSize: 5 },
  B2: { label: "B2 rung — personal experience, simple hypotheticals, explain and compare", sliceSize: 9 },
};

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Builds the bank text for ONE A1–B2 rung — the target rung ET most recently
 * judged — in the session language. usedQuestions holds the bank ids already
 * offered this session (any rung); once a rung's own pool would run short of
 * its slice size, that rung's ids are dropped from usedQuestions and the pool
 * refills, so the full set cycles once before anything repeats in a session.
 */
export function buildQuestionBank(
  targetRung: "A1" | "A2" | "B1" | "B2",
  usedQuestions: string[],
  language: ConvLang
): { bankText: string; updatedUsedQuestions: string[] } {
  const { label, sliceSize } = SLICE_BY_RUNG[targetRung];
  const questions = bankFor(targetRung);
  let pool = questions.filter((q) => !usedQuestions.includes(q.id));
  let carriedUsed = usedQuestions;
  if (pool.length < sliceSize) {
    // This rung's pool is exhausted — cycle it: drop only this rung's entries
    // from usedQuestions (other rungs' tracking is untouched) and refill.
    carriedUsed = usedQuestions.filter((id) => !questions.some((q) => q.id === id));
    pool = questions;
  }
  const chosen = shuffle(pool).slice(0, sliceSize);
  return {
    bankText: `${label}:\n${chosen.map((q) => `- ${q.text[bankLang(language)]}`).join("\n")}`,
    updatedUsedQuestions: [...carriedUsed, ...chosen.map((q) => q.id)],
  };
}

// ─── Ready-made phrases, per language ────────────────────────────────────────

// Deciding the NEXT rung is no longer this prompt's job — that judgment moved
// out to ET (lib/level-assessment.ts), a small dedicated call fired
// non-blocking as soon as the previous answer's transcript is available, so
// this call can be "just" about answering instead of also reasoning about
// pacing every single turn. rung is app/page.tsx's currentRungRef — whatever
// ET's most recently COMPLETED result says, best-effort (see the 2026-08-12
// session log entry for why this is deliberately non-blocking).
// Hardcoded per-language phrase sets. An earlier version of these rules told
// the model to "translate the idea" of English example phrases into the
// target language on the fly — that backfired twice: first the model just
// copied the English words verbatim, then (once that was banned) it started
// inventing its own recap-style pivot ("Paris, donc." / "Le 11e, donc, pour
// son dynamisme.") which is itself a paraphrase of the user's answer — a
// mechanical-sounding pattern the rules explicitly forbid elsewhere. Giving
// the model real, ready-to-use words in the target language removes the
// on-the-fly translation step (and the room for creative reinterpretation)
// entirely. Formal register (vous/Sie/usted/Lei/u) matches the register the
// exam persona already uses in practice for each language.
export const PIVOT_WORDS: Record<ConvLang, string> = {
  fr: `"D'accord." / "Je vois." / "Entendu." / "Très bien." / "Bien sûr." / "En effet." / "Effectivement." / "Je comprends." / "Voilà."`,
  "nl-BE": `"Juist." / "Inderdaad." / "Ik snap het." / "Uiteraard." / "Oké." / "Duidelijk." / "Goed zo." / "Zeker."`,
  "nl-NL": `"Juist." / "Inderdaad." / "Ik snap het." / "Uiteraard." / "Oké." / "Duidelijk." / "Goed zo." / "Zeker."`,
  es: `"Ya veo." / "De acuerdo." / "Entendido." / "Por supuesto." / "En efecto." / "Claro." / "Muy bien." / "Comprendo."`,
  it: `"Capisco." / "D'accordo." / "Certo." / "Infatti." / "Va bene." / "Chiaro." / "Ho capito."`,
  de: `"Verstehe." / "In Ordnung." / "Klar." / "Genau." / "Gut." / "Ach so." / "Natürlich."`,
  en: `"Right." / "Fair enough." / "I see." / "All right." / "Of course." / "Indeed." / "Understood." / "Got it." / "Okay, then."`,
};
export const BRIDGE_PHRASES: Record<ConvLang, string> = {
  fr: `"Passons à autre chose." / "Autre chose :" / "Parlons d'autre chose." / "Et sinon," / "Dites-moi," / "Changeons un peu de sujet."`,
  "nl-BE": `"Laten we iets anders bespreken." / "Iets anders:" / "En verder," / "Vertel eens," / "Even iets anders:"`,
  "nl-NL": `"Laten we iets anders bespreken." / "Iets anders:" / "En verder," / "Vertel eens," / "Even iets anders:"`,
  es: `"Pasemos a otra cosa." / "Otra cosa:" / "Hablemos de otra cosa." / "Y por otro lado," / "Cuénteme,"`,
  it: `"Passiamo ad altro." / "Un'altra cosa:" / "Parliamo d'altro." / "E invece," / "Mi dica,"`,
  de: `"Kommen wir zu etwas anderem." / "Etwas anderes:" / "Sprechen wir über etwas anderes." / "Und sonst," / "Sagen Sie mal,"`,
  en: `"Let's move on." / "On a different note," / "Tell me about something else." / "Moving on," / "Now, tell me,"`,
};
/** Formal address the examiner keeps throughout (none to enforce in English). */
const FORMAL_ADDRESS: Record<ConvLang, string> = {
  fr: `"vous", never "tu"`,
  "nl-BE": `"u", never "je"/"jij"`,
  "nl-NL": `"u", never "je"/"jij"`,
  es: `"usted", never "tú"`,
  it: `"Lei", never "tu"`,
  de: `"Sie", never "du"`,
  en: "",
};
const FOLLOWUP_PROMPTS: Record<ConvLang, string> = {
  fr: `"Pourquoi cela ?" / "Donnez-moi un exemple." / "Pouvez-vous en dire plus ?"`,
  "nl-BE": `"Waarom is dat?" / "Geef me een voorbeeld." / "Kunt u daar meer over vertellen?"`,
  "nl-NL": `"Waarom is dat?" / "Geef me een voorbeeld." / "Kunt u daar meer over vertellen?"`,
  es: `"¿Por qué?" / "Deme un ejemplo." / "¿Puede contarme más?"`,
  it: `"Perché?" / "Mi faccia un esempio." / "Può dirmi di più?"`,
  de: `"Warum?" / "Geben Sie mir ein Beispiel." / "Können Sie mehr dazu sagen?"`,
  en: `"Why is that?" / "Give me an example." / "Can you say more?"`,
};
const CLOSING_EXAMPLES: Record<ConvLang, string> = {
  fr: `"Merci, j'ai maintenant assez d'éléments pour évaluer votre niveau. Ceci conclut notre échange."`,
  "nl-BE": `"Bedankt, ik heb nu genoeg informatie om uw niveau te beoordelen. Dit besluit ons gesprek."`,
  "nl-NL": `"Bedankt, ik heb nu genoeg informatie om uw niveau te beoordelen. Dit besluit ons gesprek."`,
  es: `"Gracias, ya tengo suficiente información para evaluar su nivel. Esto concluye nuestra conversación."`,
  it: `"Grazie, ora ho abbastanza informazioni per valutare il suo livello. Questo conclude la nostra conversazione."`,
  de: `"Danke, ich habe jetzt genug Informationen, um Ihr Niveau zu beurteilen. Damit ist unser Gespräch beendet."`,
  en: `"Thank you, I now have enough information to assess your level. This concludes our session."`,
};

// ─── The examiner prompt: three layers ───────────────────────────────────────
//
// Audit of 2026-11-17 (doc/examiner-prompt-audit-2026-11-17.md): every rule
// used to be sent on every turn, so the turn's own instruction ("ask this bank
// question") had to say it "overrides" rules telling the opposite ("follow up
// on what they said", "end with a warm-up question"…), and it sat before the
// whole conversation history. The imposed question was asked about one turn
// in two (11–12/20, small and large). Now:
//
//   1. the CORE — who Léa is, how she speaks, what she never asks — identical
//      on every turn (system prompt);
//   2. the rules of this KIND of turn, and only those (system prompt):
//      opening, free (A2–B2, she picks from the bank slice), imposed (the code
//      picks: A1, C1/C2, client profiles), closing;
//   3. the TURN NOTE — this turn's instruction (the question to ask, the topic
//      switch, "ask it again simpler"…) — appended to the speaker's last
//      message, the last thing the model reads (withTurnNote).

/** What this turn has to do — decided in lib/examiner-prompt.ts. */
export type TurnSpec =
  | { kind: "opening"; openerQuestion: string; easy: boolean }
  | { kind: "closing" }
  /** A2–B2: the model asks its own question at `rung`, inspired by the bank slice. */
  | {
      kind: "free";
      bankText: string;
      avoidDomain?: TopicDomain;
      switchToDomain?: TopicDomain;
      /** The speaker still didn't understand after the simpler re-ask: drop the question. */
      dropQuestion?: boolean;
    }
  /** The code chose the question (A1, C1/C2 bank, client profile). */
  | {
      kind: "ask";
      question: string;
      /** Asked exactly as written (A1, client questions) rather than "a few words adapted so it flows". */
      verbatim: boolean;
      /** The words to open the reply with (a pivot or a bridge, picked by pickOpener), or "" for none. */
      opener: string;
      /** The previous question is dropped (still not understood after the simpler re-ask). */
      dropQuestion?: boolean;
      /** A forced topic switch led to this question. */
      leaving?: TopicDomain;
    }
  /** The pre-written follow-up(s) of the bank question just asked (A1, C1/C2). */
  | { kind: "followUp"; followUps: string[]; exact: boolean }
  /** The speaker didn't understand the last question: the same one again, simpler. */
  | { kind: "clarify"; simplerQuestion?: string };

/** The bare phrases of a PIVOT_WORDS / BRIDGE_PHRASES list. */
function phraseList(list: string): string[] {
  return [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/**
 * The words a code-chosen question opens with: a neutral pivot, or — on a
 * change of subject above A2, one time in two — a bridge. Never the one the
 * previous reply opened with. Picked here rather than by the model, which
 * otherwise opens nearly every such turn with the same one ("Moving on").
 */
export function pickOpener(language: ConvLang, previousReply: string, opts: { allowBridge: boolean }): string {
  const useBridge = opts.allowBridge && Math.random() < 0.5;
  const all = phraseList(useBridge ? BRIDGE_PHRASES[language] : PIVOT_WORDS[language]);
  const fresh = all.filter((p) => !previousReply.trim().startsWith(p.replace(/[,:]$/, "")));
  const pool = fresh.length ? fresh : all;
  return pool[Math.floor(Math.random() * pool.length)] ?? "";
}

/** "Moving on," + "how has…" → "Moving on, how has…"; "Right." + "How has…" → "Right. How has…". */
export function joinOpener(opener: string, question: string): string {
  if (!opener) return question;
  if (/[,:]$/.test(opener)) return `${opener} ${question.charAt(0).toLocaleLowerCase()}${question.slice(1)}`;
  return `${opener} ${question}`;
}

/**
 * The examiner's reply on a client-profile turn, built by code rather than
 * the model: a neutral pivot (never the one the last reply opened with), then
 * the question word for word. The model ignored the required question in most
 * replies when asked to (2026-11-16, 29/36 missed on mistral-small) and the
 * client wants it asked exactly as written.
 */
export function profileQuestionReply(language: ConvLang, question: string, lastExaminerReply = ""): string {
  return joinOpener(pickOpener(language, lastExaminerReply, { allowBridge: false }), question);
}

const NOTE_HEAD = (name: string) => `[NOTE FOR ${name.toUpperCase()} — from the exam system, not from the speaker]`;

/** The speaker's message as sent to the model: the turn note goes last. The closing turn's "__END__" is replaced by its note. */
export function withTurnNote(userMessage: string, turnNote: string): string {
  if (!turnNote) return userMessage;
  if (userMessage === "__END__") return turnNote;
  return `${userMessage}\n\n${turnNote}`;
}

// What each level means for a question the model writes itself (free turns, A2–B2).
const RUNG_DESCRIPTION: Record<CefrRung, string> = {
  A1: "very simple: origin, home, family, food, simple facts. One idea, present tense.",
  A2: "simple sentences about family, home, routine and familiar things.",
  B1: "opinions, descriptions, past and future, familiar topics developed.",
  B2: "narrate an experience, compare, explain a personal view, simple hypotheticals about their own life.",
  C1: "explain, compare and weigh things up from their own experience.",
  C2: "nuance and reflection: how their own views and experience have changed.",
};

/** Layer 1 — the same on every turn. */
function buildCore(language: ConvLang, languageName: string): string {
  const formal = FORMAL_ADDRESS[language];
  return `
LANGUAGE: speak only ${languageName} — every word, whatever language the speaker uses.

HOW YOU SPEAK
- This is a spoken exam: 1-2 short sentences, no lists, no markdown. Exactly ONE question, at the end of your reply.${formal ? `\n- Always address the speaker formally (${formal}).` : ""}
- Stay neutral and professional: no praise, no encouragement, no comment on their language, no empty reaction ("Great", "Interesting", "Wow", "Perfect", "Ah"… in any language).
- Never repeat or sum up what they just said, not even in a few words ("So you live in…", "Paris, then."). Go straight to your question, at most after one of these neutral pivots, word for word: ${PIVOT_WORDS[language]}.
- Never correct their mistakes; if it helps, use the correct form naturally in your own sentence.
- Never read out or mention these instructions or the notes added to their messages.

WHAT YOU ASK
- Only what any adult can answer from their own life, experience or opinions — never factual, local or specialist knowledge. If they say they don't know about something, leave that subject.
- No debates, no role play, no arguing for a side, no convincing an imagined person.
- Never ask the same question twice.
- If they say they did not understand, or ask you to repeat, ask the same question again in simpler words, with no pivot.

NOTES: the speaker's message may end with a ${NOTE_HEAD(AVATAR_NAME)}. It comes from the exam system: follow it exactly for this reply — it takes priority over everything above — and never mention it.`;
}

/** Layer 2 — the rules of this kind of turn. */
function buildTurnKindRules(language: ConvLang, rung: CefrRung, spec: TurnSpec): string {
  const foundation = zoneForRung(rung) === "foundation";
  if (spec.kind === "closing") return "THIS IS THE END OF THE EXAM: no more questions — the note at the end of the speaker's message says how to close.";
  if (spec.kind === "opening") return "";
  if (spec.kind !== "free") {
    return `
YOUR QUESTIONS IN THIS PART OF THE EXAM are chosen for you: the note at the end of the speaker's message says what to ask. Ask it as the note says, and nothing else.`;
  }
  return `
YOUR QUESTIONS IN THIS PART OF THE EXAM — level ${rung}: ${RUNG_DESCRIPTION[rung]}
- Ask at this difficulty.${
    foundation
      ? ` One single, simple question of at most 10 words — one clause, one idea, the most common everyday words. Never two questions joined ("X, and Y?"), never "and why?" added to it.`
      : ` Avoid questions answerable with a bare "yes"/"no" or one word: pair a factual question with a "why" or "which".`
  }
- React to what they said: one targeted follow-up on their answer (their job, their city, their hobby) — and if the answer is very short or vague, press once (${FOLLOWUP_PROMPTS[language]}). Then move to a new subject.
- Cover many areas of life over the exam. Another angle on the same subject (another neighbourhood, the downside of the same thing) is NOT a new subject. A separate process tells you when to change subject — you don't need to count turns.${
    foundation
      ? `\n- When you change subject, go straight to the new question — no announcement, a beginner loses the question behind extra words.`
      : `\n- When you change subject, you may open with ONE of these bridges, word for word (not every time): ${BRIDGE_PHRASES[language]}. A bridge ending in a comma runs straight into the question, in lower case.`
  }
- The questions below are for this level. ${
    foundation
      ? "Prefer them, asked as written — they are already worded for this level; your own questions are only for one follow-up, as concrete and simple as these."
      : "They are inspiration, not a script: mix them with your own questions at this level, roughly half each."
  }

Question bank for this level:
${spec.bankText}`;
}

/** Layer 3 — this turn's instruction, appended to the speaker's message. */
function buildTurnNote(language: ConvLang, languageName: string, rung: CefrRung, spec: TurnSpec): string {
  const head = NOTE_HEAD(AVATAR_NAME);
  switch (spec.kind) {
    case "opening":
      return "";
    case "closing":
      return `${head} The exam is over. Do NOT ask any question. Say one or two polite closing sentences in ${languageName} that clearly end the conversation, close in spirit to: ${CLOSING_EXAMPLES[language]}`;
    case "clarify":
      return `${head} The speaker did not understand your last question. Ask the SAME question again, much simpler: at most 8 words, the most common everyday words, present tense, no idiom — an easy choice ("X or Y?") or a yes/no question is fine here. It must be worded clearly differently from last time.${
        spec.simplerQuestion ? ` Use this simpler version (as is, or shorter): "${spec.simplerQuestion}"` : ""
      } No pivot, no comment on their difficulty, no apology.`;
    case "followUp":
      return spec.exact
        ? `${head} Stay on the subject of your last question and ask exactly this one short follow-up (adapt at most a word so it connects to their answer), with no pivot:\n"${spec.followUps[0]}"\nIf their answer makes it pointless (e.g. "no"), ask another very short question on the same subject instead; if they did not answer your last question at all, ask it again more simply.`
        : `${head} Stay on the subject of your last question and ask ONE follow-up on what they just said, based on the one of these that fits their answer best (adapt a few words so it connects to it), with no pivot:\n${spec.followUps.map((f) => `- "${f}"`).join("\n")}\nIf they did not really answer your last question, ask its core again more simply instead.`;
    case "ask": {
      const drop = spec.dropQuestion ? " The speaker still did not understand your previous question, even after you made it simpler: drop it for good, with no comment." : "";
      const leave = spec.leaving ? ` You are leaving ${DOMAIN_LABEL[spec.leaving]} for good.` : "";
      const reply = joinOpener(spec.opener, spec.question);
      const how = spec.verbatim
        ? "Your whole reply is exactly this, word for word, nothing before or after it:"
        : "Your whole reply is this next question, with its opening words — you may adapt a few words so it flows, but keep its meaning, scope and difficulty, and add nothing before or after it:";
      return `${head} Do not follow up on this answer.${drop}${leave} ${how}\nQUESTION TO ASK\n"${reply}"`;
    }
    case "free": {
      if (spec.dropQuestion) {
        return `${head} The speaker still did not understand your question, even simpler. Drop it and its subject for good. Ask a new, very easy question about something concrete and familiar (food, family, the weather): at most 8 words, the most common everyday words, present tense. No pivot, no comment.`;
      }
      if (spec.avoidDomain) {
        const target = spec.switchToDomain;
        const seeds = target ? SWITCH_SEEDS[target] : [];
        const seed = seeds[Math.floor(Math.random() * seeds.length)];
        return `${head} Change subject now: leave ${DOMAIN_LABEL[spec.avoidDomain]} for good — no follow-up on this answer, and no other angle on it.${
          target ? ` New subject: ${DOMAIN_LABEL[target]}. Idea to put in your own words in ${languageName}, at level ${rung}: "${seed}"` : ""
        } Open with a neutral pivot${zoneForRung(rung) === "foundation" ? "" : " or a bridge"}, never a recap of their answer.`;
      }
      return `${head} Your next question is at level ${rung}.`;
    }
  }
}

const LANGUAGE_NAME: Record<ConvLang, string> = {
  fr: "French",
  "nl-BE": "Dutch (Belgian)",
  "nl-NL": "Dutch (Netherlands)",
  es: "Spanish",
  it: "Italian",
  de: "German",
  en: "English",
};

// Who Léa is, in the test language (first lines of the prompt).
const PERSONA: Record<ConvLang, string> = {
  fr: `Tu es ${AVATAR_NAME}. Ton objectif est de faire parler ton interlocuteur le plus possible en lui posant des questions. Tu es directe et professionnelle — tu n'es pas là pour le mettre à l'aise.`,
  "nl-BE": `Je bent ${AVATAR_NAME}. Jouw doel is om je gesprekspartner zo veel mogelijk te laten spreken door vragen te stellen. Je bent direct en professioneel — niet hier om hen op hun gemak te stellen.`,
  "nl-NL": `Je bent ${AVATAR_NAME}. Jouw doel is om je gesprekspartner zo veel mogelijk te laten spreken door vragen te stellen. Je bent direct en professioneel — niet hier om hen op hun gemak te stellen.`,
  es: `Eres ${AVATAR_NAME}. Tu objetivo es hacer que la persona hable lo máximo posible haciéndole preguntas. Eres directa y profesional — no estás aquí para que se sienta cómoda.`,
  it: `Sei ${AVATAR_NAME}. Il tuo obiettivo è far parlare il più possibile il tuo interlocutore facendogli domande. Sei diretta e professionale — non sei qui per metterlo a suo agio.`,
  de: `Du bist ${AVATAR_NAME}. Dein Ziel ist es, dein Gegenüber so viel wie möglich zum Sprechen zu bringen, indem du Fragen stellst. Du bist direkt und professionell — nicht hier, um es ihm bequem zu machen.`,
  en: `You are ${AVATAR_NAME}. Your goal is to get the speaker to talk as much as possible by asking questions. You are direct and professional — not here to put them at ease.`,
};

// The language reminder that closes the prompt, in the test language; the
// second part only when a bank slice is shown (free turns).
const LANGUAGE_TAIL: Record<ConvLang, { always: string; bank: string }> = {
  fr: { always: "- Tu dois TOUJOURS répondre en français, quelle que soit la langue utilisée par l'interlocuteur.", bank: "- Les questions de la banque sont déjà rédigées en français : utilise-les telles qu'elles sont écrites." },
  "nl-BE": {
    always: "- Antwoord ALTIJD in het Nederlands (Belgische variant), ongeacht welke taal de gesprekspartner gebruikt.\n- Gebruik waar mogelijk Belgisch-Nederlandse uitdrukkingen en woordenschat.",
    bank: "- De vragen uit de vragenbank zijn al in het Nederlands geschreven: gebruik ze zoals ze er staan.",
  },
  "nl-NL": {
    always: "- Antwoord ALTIJD in het Nederlands zoals het in Nederland gesproken wordt, ongeacht welke taal de gesprekspartner gebruikt.\n- Gebruik geen typisch Belgisch-Nederlandse uitdrukkingen of woordenschat.",
    bank: "- De vragen uit de vragenbank zijn al in het Nederlands geschreven: gebruik ze zoals ze er staan.",
  },
  es: { always: "- Responde SIEMPRE en español, sea cual sea el idioma que use la persona.", bank: "- Las preguntas del banco ya están redactadas en español: úsalas tal como están escritas." },
  it: { always: "- Rispondi SEMPRE in italiano, qualunque sia la lingua usata dall'interlocutore.", bank: "- Le domande del banco sono già scritte in italiano: usale così come sono." },
  de: { always: "- Antworte IMMER auf Deutsch, egal welche Sprache die Person benutzt.", bank: "- Die Fragen aus der Fragenbank sind bereits auf Deutsch formuliert: verwende sie so, wie sie dastehen." },
  en: { always: "- Always reply in English regardless of what language the speaker uses.", bank: "" },
};

// The opening turn's instructions, in the test language (opening turn only).
// The warm-up question is picked in code (lib/question-bank/warmup.ts, Track
// AA-01) — the model used to pick its own and kept defaulting to "where are you from".
const OPENING: Record<ConvLang, (q: string) => string> = {
  fr: (q) => `OUVERTURE — compose ta propre introduction, différente à chaque session (ne réutilise jamais la même formulation) :
- Salue brièvement et présente-toi explicitement avec la formule « je m'appelle ${AVATAR_NAME} » (ne te contente pas de dire ton prénom seul).
- Mentionne que la conversation durera ${DURATION_PHRASE.fr} pour évaluer le niveau de français.
- Termine par cette question de mise en route, telle quelle ou à peine reformulée : « ${q} »
- Garde l'ensemble court : 2-3 phrases maximum.`,
  "nl-BE": (q) => `OPENING — stel je eigen introductie samen, elke sessie anders (hergebruik nooit dezelfde formulering):
- Groet kort en stel jezelf expliciet voor met « ik ben ${AVATAR_NAME} » (noem niet enkel je voornaam).
- Zeg daarna letterlijk, woord voor woord, deze zin: « ${NL_INTRO} »
- Eindig met deze opwarmvraag, zoals ze is of licht aangepast: « ${q} »
- Houd het geheel kort: maximaal 2-3 zinnen.`,
  "nl-NL": (q) => `OPENING — stel je eigen introductie samen, elke sessie anders (hergebruik nooit dezelfde formulering):
- Groet kort en stel jezelf expliciet voor met « ik ben ${AVATAR_NAME} » (noem niet enkel je voornaam).
- Zeg daarna letterlijk, woord voor woord, deze zin: « ${NL_INTRO} »
- Eindig met deze opwarmvraag, zoals ze is of licht aangepast: "${q}"
- Houd het geheel kort: maximaal 2-3 zinnen.`,
  es: (q) => `APERTURA — compón tu propia introducción, distinta en cada sesión (nunca reutilices la misma formulación):
- Saluda brevemente y preséntate explícitamente con «me llamo ${AVATAR_NAME}» (no digas solo tu nombre).
- Menciona que la conversación durará ${DURATION_PHRASE.es} para evaluar el nivel de español.
- Termina con esta pregunta de calentamiento, tal cual o apenas reformulada: «${q}»
- Mantenlo breve: 2-3 frases como máximo.`,
  it: (q) => `APERTURA — componi la tua introduzione, diversa a ogni sessione (non riutilizzare mai la stessa formulazione):
- Saluta brevemente e presentati esplicitamente con «mi chiamo ${AVATAR_NAME}» (non dire solo il tuo nome).
- Indica che la conversazione durerà ${DURATION_PHRASE.it} per valutare il livello di italiano.
- Concludi con questa domanda di riscaldamento, così com'è o appena riformulata: «${q}»
- Tieni tutto breve: massimo 2-3 frasi.`,
  de: (q) => `ERÖFFNUNG — formuliere deine eigene Einleitung, jede Sitzung anders (verwende nie dieselbe Formulierung):
- Begrüße kurz und stelle dich ausdrücklich mit „ich heiße ${AVATAR_NAME}" vor (nenne nicht nur deinen Vornamen).
- Erwähne, dass das Gespräch ${DURATION_PHRASE.de} dauert, um das Deutschniveau einzuschätzen.
- Schließe mit dieser Aufwärmfrage, unverändert oder leicht umformuliert: „${q}"
- Halte alles kurz: höchstens 2-3 Sätze.`,
  en: (q) => `OPENING — compose your own introduction, different every session (never reuse the same wording):
- Greet briefly and introduce yourself explicitly with "my name is ${AVATAR_NAME}" (don't just state your first name on its own).
- Mention the conversation will last ${DURATION_PHRASE.en} to assess their English level.
- End with this warm-up question, as is or very lightly reworded: "${q}"
- Keep the whole thing short: 2-3 sentences maximum.`,
};

const EASY_OPENING_NOTE = (languageName: string, durationPhrase: string, fixedIntro?: string) => `

EASY OPENING (overrides the OPENING section above where they differ): the speaker may be a beginner who catches only a few words, so use very short sentences (at most 8 words each) and only the most common everyday words — but do introduce the conversation, so the first question doesn't come out of nowhere. In this order:
1. Greet and say your name in one short sentence (e.g. "Hello, my name is ${AVATAR_NAME}.").
${fixedIntro
  ? `2. Say exactly this sentence, word for word (it is the one exception to the 8-word limit): "${fixedIntro}" — and no other details about the assessment.`
  : `2. Say, in one or two short, simple sentences, that you will talk together for ${durationPhrase} and that you will ask some simple questions (e.g. "We will talk for a few minutes. I will ask you some questions."). No other details about the assessment.`}
3. Ask the opening question — ONE short, simple question of at most 8 words. If the opening question given above has two parts ("X, and why?" / two questions in a row), ask ONLY its first part.
The whole opening stays under ${fixedIntro ? 45 : 35} words, in ${languageName}, and sounds like a natural spoken greeting.`;

/**
 * The examiner prompt for one turn: `system` (core + this kind of turn's
 * rules) and `turnNote` (this turn's instruction, to append to the speaker's
 * message with withTurnNote — "" when there is none).
 */
export function buildTurnPrompt(language: ConvLang, rung: CefrRung, spec: TurnSpec): { system: string; turnNote: string } {
  const languageName = LANGUAGE_NAME[language];
  const tail = LANGUAGE_TAIL[language];
  const parts = [PERSONA[language]];
  if (spec.kind === "opening") {
    parts.push(OPENING[language](spec.openerQuestion));
    if (spec.easy) parts.push(EASY_OPENING_NOTE(languageName, DURATION_PHRASE[language], FIXED_INTRO_SENTENCE[language]).trim());
  }
  parts.push(buildCore(language, languageName).trim());
  const kindRules = buildTurnKindRules(language, rung, spec).trim();
  if (kindRules) parts.push(kindRules);
  parts.push([tail.always, spec.kind === "free" ? tail.bank : ""].filter(Boolean).join("\n"));
  return { system: parts.join("\n\n"), turnNote: buildTurnNote(language, languageName, rung, spec) };
}

export type ConvLang = "fr" | "en" | "nl-BE" | "nl-NL" | "es" | "it" | "de";

const CONV_LANGS: ConvLang[] = ["fr", "en", "nl-BE", "nl-NL", "es", "it", "de"];

/**
 * The languages the question bank is written in. nl-NL has no texts of its
 * own: it asks the nl-BE ones (standard Dutch, same questions — roadmap L-06).
 */
export type BankLang = Exclude<ConvLang, "nl-NL">;

export function bankLang(lang: ConvLang): BankLang {
  return lang === "nl-NL" ? "nl-BE" : lang;
}

export function isConvLang(value: unknown): value is ConvLang {
  return typeof value === "string" && (CONV_LANGS as string[]).includes(value);
}
