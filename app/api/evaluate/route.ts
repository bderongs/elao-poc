import { NextResponse } from "next/server";
import {
  CEFR_SYSTEM_PROMPT,
  buildEvaluationUserMessage,
} from "@/lib/cefr-prompt";
import type { ConvLang } from "@/lib/conversation-prompts";
import { getProvider } from "@/lib/llm/registry";
import { LIVE_CONVERSATION_MODEL_ID } from "@/lib/cefr-eval";
import { logServerEvent } from "@/lib/server-log";

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
}

export async function POST(req: Request) {
  const { language, userTurns, pronunciationContext } = (await req.json()) as EvalRequest;

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

    // Strip any accidental markdown fences and parse
    const cleaned = text.replace(/^```json\s*|\s*```$/g, "").trim();
    const evaluation = JSON.parse(cleaned);

    logServerEvent("cefr_eval_complete", { provider: provider.id, model: provider.modelLabel });
    return NextResponse.json(evaluation);
  } catch (e) {
    return NextResponse.json(
      { error: String(e) },
      { status: 500 },
    );
  }
}
