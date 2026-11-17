import { buildQuestionBank, buildTurnPrompt, pickOpener, bankLang, type ConvLang, type TurnSpec } from "@/lib/conversation-prompts";
import { pickProfileQuestion, profileRemaining, type TestProfile } from "@/lib/test-profile-types";
import { isCefrRung, zoneForRung, type CefrRung } from "@/lib/cefr-rung";
import { isTopicDomain } from "@/lib/topic-domain";
import { isCodePickedRung, pickBankQuestion, questionById } from "@/lib/question-bank";
import { CLARIFY_GIVE_UP_ATTEMPT } from "@/lib/comprehension";

/**
 * A1/C1/C2 question-bank state, round-tripped with the client like usedQuestions.
 * currentId: the bank question asked most recently at A1/C1/C2.
 * followUpDone: whether its one follow-up turn has already happened.
 */
export interface BankState {
  currentId?: string;
  followUpDone?: boolean;
  /** Client-profile questions asked so far (lib/test-profile-types.ts). */
  profileAsked?: string[];
  /** The profile question asked on the turn just before, if it was one. */
  profileCurrent?: string;
}

/**
 * Builds the examiner's system prompt for one turn — shared by the live
 * conversation (app/api/chat/route.ts) and the admin conversation simulator
 * (lib/conversation-sim.ts), so the simulator exercises exactly the prompt
 * real users get rather than a copy of it.
 *
 * Which question gets asked (Track AA, lib/question-bank/):
 *   opening   a warm-up bank question, whatever the starting rung.
 *   A2–B2     the model picks from a slice of the rung's bank.
 *   A1, C1/C2 the code picks: bank question → ONE pre-written follow-up →
 *             next bank question (in a new domain), and so on. A forced topic
 *             switch (avoidDomain) always moves on to a new bank question.
 *
 * "Didn't understand" (clarify): the first one re-asks the same question
 * simpler; from CLARIFY_GIVE_UP_ATTEMPT on, the question is dropped and the
 * turn picks a new one as above (dropQuestion).
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
  /** How many "didn't understand" in a row on this question, this one included (default 1). From CLARIFY_GIVE_UP_ATTEMPT on, the question is dropped instead of re-asked. */
  clarifyAttempt?: number;
  /** The client profile of this test (`?profile=`, lib/test-profiles.ts) — ignored when its language is not the test's. */
  profile?: TestProfile | null;
  /** The end of the test is near: a missing profile question is asked even out of its level range (lib/test-profile-types.ts). */
  profileUrgent?: boolean;
  /** The examiner's last reply — the opener of a code-chosen question is never the one it opened with. */
  previousReply?: string;
}): {
  system: string;
  /** This turn's instruction: append it to the speaker's message with withTurnNote ("" = none). */
  turnNote: string;
  targetRung: CefrRung;
  updatedUsedQuestions: string[];
  bankState: BankState;
  profileRemaining: number | null;
  profileQuestion?: string;
} {
  const { language, rung, isStart, isEnd } = params;
  // First "didn't understand": re-ask the same question simpler. Again after
  // that: drop it and move on (a new question, picked like any other turn).
  const giveUp = params.clarify === true && (params.clarifyAttempt ?? 1) >= CLARIFY_GIVE_UP_ATTEMPT;
  const clarify = params.clarify === true && !giveUp;
  const usedQuestions = params.usedQuestions ?? [];
  const bankState = params.bankState ?? {};
  const targetRung: CefrRung = isCefrRung(rung) ? rung : "A2";
  const previousReply = params.previousReply ?? "";
  // A clarify turn re-asks the current question, so a topic switch request
  // would contradict it — it wins over avoidDomain/switchToDomain.
  const avoidDomain = !params.clarify && isTopicDomain(params.avoidDomain) ? params.avoidDomain : undefined;
  const switchToDomain = avoidDomain && isTopicDomain(params.switchToDomain) ? params.switchToDomain : undefined;
  const foundation = zoneForRung(targetRung) === "foundation";

  const profile = params.profile && params.profile.active && params.profile.language === language ? params.profile : null;
  const profileAsked = bankState.profileAsked ?? [];

  // Every turn carries the profile questions asked so far; profileCurrent
  // only survives when the state passed in sets it (a profile turn, or a
  // clarify that re-asks one).
  const build = (spec: TurnSpec, used: string[], state: BankState) => {
    const asked = state.profileAsked ?? profileAsked;
    return {
      ...buildTurnPrompt(language, targetRung, spec),
      targetRung,
      updatedUsedQuestions: used,
      bankState: { ...state, ...(asked.length ? { profileAsked: asked } : {}) },
      profileRemaining: profile ? profileRemaining(profile, asked) : null,
    };
  };
  /** A code-chosen question: a new subject, so a bridge is allowed above A2. */
  const ask = (question: string, verbatim: boolean): TurnSpec => ({
    kind: "ask",
    question,
    verbatim,
    opener: pickOpener(language, previousReply, { allowBridge: !foundation }),
    ...(giveUp ? { dropQuestion: true } : {}),
    ...(avoidDomain ? { leaving: avoidDomain } : {}),
  });

  if (isStart) {
    // Starting at A1/A2 (explicit or the A2 default): a beginner can't catch the
    // regular warm-up wording, so open with the A1 bank and a short intro in simple words.
    const { question, updatedUsedIds } = pickBankQuestion({ rung: foundation ? "A1" : "warmup", usedIds: usedQuestions });
    // Kept as the current question (follow-up already "done") so a first C1/C2
    // pick avoids the warm-up's topic.
    return build({ kind: "opening", openerQuestion: question.text[bankLang(language)], easy: foundation }, updatedUsedIds, { currentId: question.id, followUpDone: true });
  }
  if (isEnd) {
    return build({ kind: "closing" }, usedQuestions, bankState);
  }

  // Client-profile questions (roadmap phase 3) come before the standard bank.
  if (profile) {
    const current = bankState.profileCurrent ? profile.questions.find((q) => q.id === bankState.profileCurrent) : undefined;
    if (clarify && current) {
      // Re-ask the profile question just asked, simpler — state unchanged.
      return build({ kind: "clarify", ...(current.simpler ? { simplerQuestion: current.simpler } : {}) }, usedQuestions, bankState);
    }
    if (!clarify) {
      const pick = pickProfileQuestion({ profile, rung: targetRung, askedIds: profileAsked, lastWasProfile: !!current, urgent: params.profileUrgent === true });
      if (pick) {
        // followUpDone: a C1/C2 bank turn after it starts a fresh bank question, no follow-up on this one.
        // profileQuestion: the chat route speaks it as written (profileQuestionReply) instead of asking the model.
        return {
          ...build(ask(pick.text, true), usedQuestions, {
            profileAsked: [...profileAsked, pick.id],
            profileCurrent: pick.id,
            followUpDone: true,
          }),
          profileQuestion: pick.text,
        };
      }
    }
  }

  if (isCodePickedRung(targetRung)) {
    const current = questionById(bankState.currentId);
    if (clarify) {
      // Re-ask the current question — no new pick, state unchanged.
      const simplerQuestion = current?.simpler?.[bankLang(language)];
      return build({ kind: "clarify", ...(simplerQuestion ? { simplerQuestion } : {}) }, usedQuestions, bankState);
    }
    // Only follow up on a question of THIS rung — after a rung change the
    // current question belongs to the other rung, so move on to a fresh one.
    if (current && current.rung === targetRung && !bankState.followUpDone && !avoidDomain && !giveUp && current.followUps?.length) {
      const followUps = current.followUps.map((f) => f[bankLang(language)]);
      return build({ kind: "followUp", followUps, exact: targetRung === "A1" }, usedQuestions, { currentId: current.id, followUpDone: true });
    }
    const { question, updatedUsedIds } = pickBankQuestion({
      rung: targetRung,
      usedIds: usedQuestions,
      preferDomain: switchToDomain,
      avoidDomain: avoidDomain ?? current?.domain,
    });
    // A1 questions are worded for beginners: asked exactly as written.
    return build(ask(question.text[bankLang(language)], targetRung === "A1"), updatedUsedIds, { currentId: question.id, followUpDone: false });
  }

  // A2–B2: narrow the bank to this turn's target rung and track which ids
  // have been offered this session — Track I-03. Called once, here, so the
  // updatedUsedQuestions echoed back matches exactly what the LLM was shown.
  if (clarify) {
    // A rephrase doesn't consume new bank questions.
    return build({ kind: "clarify" }, usedQuestions, {});
  }
  const { bankText, updatedUsedQuestions } = buildQuestionBank(targetRung, usedQuestions, language);
  return build(
    { kind: "free", bankText, ...(giveUp ? { dropQuestion: true } : avoidDomain ? { avoidDomain, ...(switchToDomain ? { switchToDomain } : {}) } : {}) },
    updatedUsedQuestions,
    // Leaving A1/C1/C2 ends that question's follow-up cycle.
    {}
  );
}
