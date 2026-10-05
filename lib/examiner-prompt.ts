import { getSystemPrompt, buildQuestionBank, buildPickedQuestionText, type ConvLang, type PromptOpts } from "@/lib/conversation-prompts";
import { isCefrRung, zoneForRung, type CefrRung } from "@/lib/cefr-rung";
import { isTopicDomain } from "@/lib/topic-domain";
import { isMasteryBankRung, pickBankQuestion, questionById } from "@/lib/question-bank";

/**
 * C1/C2 question-bank state, round-tripped with the client like usedQuestions.
 * currentId: the bank question asked most recently at C1/C2.
 * followUpDone: whether its one follow-up turn has already happened.
 */
export interface BankState {
  currentId?: string;
  followUpDone?: boolean;
}

/**
 * Builds the examiner's system prompt for one turn — shared by the live
 * conversation (app/api/chat/route.ts) and the admin conversation simulator
 * (lib/conversation-sim.ts), so the simulator exercises exactly the prompt
 * real users get rather than a copy of it.
 *
 * Which question gets asked (Track AA, lib/question-bank/):
 *   opening   a warm-up bank question, whatever the starting rung.
 *   A1–B2     the model picks from a slice of the rung's bank.
 *   C1/C2     the code picks: bank question → ONE pre-written follow-up →
 *             next bank question (in a new domain), and so on. A forced topic
 *             switch (avoidDomain) always moves on to a new bank question.
 */
export function buildExaminerPrompt(params: {
  language: ConvLang;
  rung?: CefrRung;
  usedQuestions?: string[];
  bankState?: BankState;
  isStart?: boolean;
  /** The closing turn ("__END__") — no question is asked, so none is picked. */
  isEnd?: boolean;
  avoidDomain?: string;
  switchToDomain?: string;
  /** The speaker didn't understand the last question (button or detected phrase, see lib/comprehension.ts) — rephrase it more simply instead of moving on. */
  clarify?: boolean;
}): { system: string; targetRung: CefrRung; updatedUsedQuestions: string[]; bankState: BankState } {
  const { language, rung, isStart, isEnd, clarify } = params;
  const usedQuestions = params.usedQuestions ?? [];
  const bankState = params.bankState ?? {};
  const targetRung: CefrRung = isCefrRung(rung) ? rung : "A2";
  // A clarify turn re-asks the current question, so a topic switch request
  // would contradict it — it wins over avoidDomain/switchToDomain.
  const avoidDomain = !clarify && isTopicDomain(params.avoidDomain) ? params.avoidDomain : undefined;
  const switchToDomain = avoidDomain && isTopicDomain(params.switchToDomain) ? params.switchToDomain : undefined;
  const domainOpts: PromptOpts = { ...(avoidDomain ? { avoidDomain } : {}), ...(switchToDomain ? { switchToDomain } : {}) };

  const build = (bank: string, opts: PromptOpts & { openerQuestion?: string }, used: string[], state: BankState) => ({
    system: getSystemPrompt(language, targetRung, bank, opts),
    targetRung,
    updatedUsedQuestions: used,
    bankState: state,
  });

  if (isStart) {
    // Starting at A1/A2 (explicit or the A2 default): a beginner can't catch the
    // regular warm-up wording, so open with the A1 bank and a very short intro.
    const easy = zoneForRung(targetRung) === "foundation";
    const { question, updatedUsedIds } = pickBankQuestion({ rung: easy ? "A1" : "warmup", usedIds: usedQuestions });
    // Kept as the current question (follow-up already "done") so a first C1/C2
    // pick avoids the warm-up's topic.
    return build("", { bankMode: "none", openerQuestion: question.text[language], ...(easy ? { easyOpening: true } : {}) }, updatedUsedIds, { currentId: question.id, followUpDone: true });
  }
  if (isEnd) {
    return build("", { bankMode: "none" }, usedQuestions, bankState);
  }

  if (isMasteryBankRung(targetRung)) {
    const current = questionById(bankState.currentId);
    if (clarify) {
      // Re-ask the current question — no new pick, state unchanged.
      const simplerQuestion = current?.simpler?.[language];
      return build("", { bankMode: "none", clarify: true, ...(simplerQuestion ? { simplerQuestion } : {}) }, usedQuestions, bankState);
    }
    // Only follow up on a question of THIS rung — after a rung change the
    // current question belongs to the other rung, so move on to a fresh one.
    if (current && current.rung === targetRung && !bankState.followUpDone && !avoidDomain && current.followUps?.length) {
      const bank = buildPickedQuestionText(targetRung, { kind: "followUp", followUps: current.followUps.map((f) => f[language]) });
      return build(bank, { bankMode: "picked" }, usedQuestions, { currentId: current.id, followUpDone: true });
    }
    const { question, updatedUsedIds } = pickBankQuestion({
      rung: targetRung,
      usedIds: usedQuestions,
      preferDomain: switchToDomain,
      avoidDomain: avoidDomain ?? current?.domain,
    });
    const bank = buildPickedQuestionText(targetRung, { kind: "ask", question: question.text[language] });
    return build(bank, { ...domainOpts, bankMode: "picked" }, updatedUsedIds, { currentId: question.id, followUpDone: false });
  }

  // A1–B2: narrow the bank to this turn's target rung and track which ids
  // have been offered this session — Track I-03. Called once, here, so the
  // updatedUsedQuestions echoed back matches exactly what the LLM was shown.
  const { bankText, updatedUsedQuestions } = buildQuestionBank(targetRung, usedQuestions, language);
  return build(
    bankText,
    clarify ? { clarify: true } : domainOpts,
    // A rephrase doesn't consume new bank questions — don't burn this slice.
    clarify ? usedQuestions : updatedUsedQuestions,
    // Leaving C1/C2 ends that question's follow-up cycle.
    {}
  );
}
