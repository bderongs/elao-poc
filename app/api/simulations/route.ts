/**
 * POST /api/simulations — runs one simulated conversation (lib/conversation-sim.ts)
 * and streams its events as NDJSON (one SimEvent per line) so the admin
 * simulator page can render turns as they're produced. Admin-only (see
 * middleware.ts). Nothing is persisted — sessions/evaluations tables are untouched.
 */

import { isConvLang } from "@/lib/conversation-prompts";
import { isCefrRung } from "@/lib/cefr-rung";
import { resolveConversationSettings } from "@/lib/conversation-settings-service";
import { runConversationSimulation } from "@/lib/conversation-sim";

export const runtime = "nodejs";
export const maxDuration = 300;

interface SimulateRequest {
  language: string;
  learnerLevel: string;
  /** Omitted → the admin per-language starting rung, like a live session without ?level=. */
  startingRung?: string;
  answers?: number;
  learnerProvider?: string;
}

export async function POST(req: Request) {
  const { language, learnerLevel, startingRung, answers, learnerProvider } = (await req.json()) as SimulateRequest;
  if (!isConvLang(language) || !isCefrRung(learnerLevel)) {
    return Response.json({ error: "language and learnerLevel are required" }, { status: 400 });
  }
  const answerCount = Number.isInteger(answers) && answers! >= 1 && answers! <= 15 ? answers! : 8;

  const settings = await resolveConversationSettings(language).catch(() => ({ startingRung: "A2" as const, stepSize: 1 }));
  const config = {
    language,
    learnerLevel,
    startingRung: isCefrRung(startingRung) ? startingRung : settings.startingRung,
    stepSize: settings.stepSize,
    answers: answerCount,
    learnerProvider: learnerProvider === "anthropic" ? ("anthropic" as const) : ("mistral" as const),
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      for await (const event of runConversationSimulation(config, req.signal)) {
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache, no-transform" },
  });
}
