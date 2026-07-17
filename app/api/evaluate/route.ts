import { NextResponse } from "next/server";
import {
  CEFR_SYSTEM_PROMPT,
  buildEvaluationUserMessage,
} from "@/lib/cefr-prompt";
import type { ConvLang } from "@/lib/conversation-prompts";
import { mistralComplete, mistralModel } from "@/lib/mistral";

interface SttContext {
  pronunciation: number;
  wpm: number;
  count: number;
  shortTurns?: number;
}

interface EvalRequest {
  language: ConvLang;
  userTurns: string[];
  azureContext?: SttContext | null;
}

export async function POST(req: Request) {
  const { language, userTurns, azureContext } = (await req.json()) as EvalRequest;

  if (!userTurns.length) {
    return NextResponse.json(
      { error: "No user turns provided" },
      { status: 400 },
    );
  }

  try {
    const text = await mistralComplete({
      model: mistralModel(),
      system: CEFR_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: buildEvaluationUserMessage(language, userTurns, azureContext ?? undefined),
        },
      ],
      maxTokens: 1500,
      json: true,
    });

    // Strip any accidental markdown fences and parse
    const cleaned = text.replace(/^```json\s*|\s*```$/g, "").trim();
    const evaluation = JSON.parse(cleaned);

    return NextResponse.json(evaluation);
  } catch (e) {
    return NextResponse.json(
      { error: String(e) },
      { status: 500 },
    );
  }
}
