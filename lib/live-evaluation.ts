/**
 * The final CEFR evaluation of a live conversation — run by the server when
 * the session is saved (lib/sessions-service.ts createSessionFromForm), from
 * the answers it has just stored. The browser never handles the evaluation
 * except to display what the save returns, so the score the candidate sees
 * and the one stored for the platform are the same object.
 *
 * The eval lab's re-runs (lib/cefr-eval.ts runCefrEvaluation) and the
 * simulator are separate paths.
 */

import {
  CEFR_SYSTEM_PROMPT,
  buildEvaluationUserMessage,
  parseCefrEvaluation,
  withAnswerEvidence,
  withC2Evidence,
} from "@/lib/cefr-prompt";
import type { LadderStep } from "@/lib/session-length";
import type { ConvLang } from "@/lib/conversation-prompts";
import { getProvider } from "@/lib/llm/registry";
import { LIVE_CONVERSATION_MODEL_ID } from "@/lib/cefr-eval";
import { logServerEvent } from "@/lib/server-log";
import { fluencyFromWpm, levelBeforeBoundaryChecks, SCORING_RULES } from "@/lib/cefr-score";
import { withBoundaryChecks, type Exchange } from "@/lib/cefr-boundary";
import { withAnalysesFor } from "@/lib/analysis-translation";
import type { UiLang } from "@/lib/ui-strings";
import type { CefrResult } from "@/lib/types";

export interface PronunciationContext {
  pronunciation: number;
  wpm: number;
  count: number;
  shortTurns?: number;
  /** The session's most-missed words — for the pronunciation line of the axis feedback. */
  weakWords?: string[];
}

export interface LiveEvaluationInput {
  language: ConvLang;
  userTurns: string[];
  pronunciationContext: PronunciationContext | null;
  /** The session's difficulty ladder — counts the C2-question answers the C2 gate needs. */
  ladderSteps: LadderStep[];
  /** Each answer with the examiner's question — the boundary checks judge the answers against what was asked. */
  exchanges: Exchange[];
  /** The candidate's interface language — the feedback is translated into it (roadmap L-04). */
  uiLang: UiLang;
}

export async function evaluateLiveConversation(input: LiveEvaluationInput): Promise<CefrResult> {
  const { language, userTurns, pronunciationContext, ladderSteps, exchanges, uiLang } = input;
  const provider = getProvider(LIVE_CONVERSATION_MODEL_ID);
  const text = await provider.complete({
    model: provider.modelLabel,
    system: CEFR_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: buildEvaluationUserMessage(language, userTurns, pronunciationContext ?? undefined),
      },
    ],
    maxTokens: 1800,
    json: true,
    context: "cefr-eval",
  });

  // Strips markdown fences, normalises dimensions to half points (Track AE)
  let evaluation = withC2Evidence(withAnswerEvidence(parseCefrEvaluation(text), userTurns), ladderSteps);
  // The speaking rate caps fluency — store the capped value so the bar users see matches the score.
  if (evaluation.dimensions.fluency !== null && pronunciationContext) {
    evaluation.dimensions.fluency = fluencyFromWpm(
      evaluation.dimensions.fluency,
      pronunciationContext.wpm,
      evaluation.answer_count ?? null,
      evaluation.words_per_answer ?? null,
    );
  }

  // Second opinion at the level boundary (lib/cefr-boundary.ts) — only when the scoring uses it
  // (4 extra calls, several seconds); never fails the evaluation.
  if (SCORING_RULES.boundaryCheck !== "off") evaluation = await withBoundaryChecks(evaluation, {
    provider,
    language,
    exchanges: exchanges.length ? exchanges : userTurns.map((answer) => ({ question: null, answer })),
    level: levelBeforeBoundaryChecks(evaluation, pronunciationContext),
  });

  // The feedback in the candidate's interface language (the admin reads the English original); never fails the evaluation.
  evaluation = await withAnalysesFor(evaluation, uiLang, "cefr-eval");

  logServerEvent("cefr_eval_complete", { provider: provider.id, model: provider.modelLabel });
  return evaluation;
}
