import { NextResponse } from "next/server";
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

interface SttContext {
  pronunciation: number;
  wpm: number;
  count: number;
  shortTurns?: number;
}

interface EvalRequest {
  language: ConvLang;
  userTurns: string[];
  pronunciationContext?: SttContext | null;
  /** The session's difficulty ladder — counts the C2-question answers the C2 gate needs. */
  ladderSteps?: LadderStep[];
  /** Each answer with the examiner's question — the boundary checks judge the answers against what was asked. */
  exchanges?: Exchange[];
}

export async function POST(req: Request) {
  const { language, userTurns, pronunciationContext, ladderSteps, exchanges } = (await req.json()) as EvalRequest;

  if (!userTurns.length) {
    return NextResponse.json(
      { error: "No user turns provided" },
      { status: 400 },
    );
  }

  try {
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
      maxTokens: 1500,
      json: true,
      context: "cefr-eval",
    });

    // Strips markdown fences, normalises dimensions to half points (Track AE)
    let evaluation = withC2Evidence(withAnswerEvidence(parseCefrEvaluation(text), userTurns), ladderSteps ?? []);
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
      exchanges: exchanges?.length ? exchanges : userTurns.map((answer) => ({ question: null, answer })),
      level: levelBeforeBoundaryChecks(evaluation, pronunciationContext ?? null),
    });

    logServerEvent("cefr_eval_complete", { provider: provider.id, model: provider.modelLabel });
    return NextResponse.json(evaluation);
  } catch (e) {
    return NextResponse.json(
      { error: String(e) },
      { status: 500 },
    );
  }
}
