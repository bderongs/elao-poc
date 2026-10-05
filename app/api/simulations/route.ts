/**
 * POST /api/simulations — runs one simulated conversation (lib/conversation-sim.ts)
 * and streams its events as NDJSON (one SimEvent per line) so the admin
 * simulator page can render turns as they're produced. Admin-only (see
 * middleware.ts). The finished run is saved as a session with source 'simulation'
 * (lib/simulation-record.ts, saveSimulationSession); a final NDJSON line
 * {type:"saved", id} tells the page where. Pass save:false to skip saving.
 */

import { isConvLang } from "@/lib/conversation-prompts";
import { isCefrRung } from "@/lib/cefr-rung";
import { resolveConversationSettings } from "@/lib/conversation-settings-service";
import { runConversationSimulation, type SimEvent } from "@/lib/conversation-sim";
import { buildSimulationRecord } from "@/lib/simulation-record";
import { saveSimulationSession } from "@/lib/sessions-service";

export const runtime = "nodejs";
export const maxDuration = 300;

interface SimulateRequest {
  language: string;
  learnerLevel: string;
  /** Omitted → the admin per-language starting rung, like a live session without ?level=. */
  startingRung?: string;
  answers?: number;
  learnerProvider?: string;
  /** Default true; false = don't persist (throwaway run). */
  save?: boolean;
  label?: string;
}

export async function POST(req: Request) {
  const { language, learnerLevel, startingRung, answers, learnerProvider, save, label } = (await req.json()) as SimulateRequest;
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
      const events: SimEvent[] = [];
      for await (const event of runConversationSimulation(config, req.signal)) {
        events.push(event);
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      }
      // An aborted run (admin hit stop) has no evaluation — not worth keeping.
      if (save !== false && !req.signal.aborted && events.some((e) => e.type === "evaluation")) {
        try {
          const record = buildSimulationRecord(events, { label: label ?? null });
          if (record) {
            const { id } = await saveSimulationSession(record);
            controller.enqueue(encoder.encode(JSON.stringify({ type: "saved", id }) + "\n"));
          }
        } catch (e) {
          controller.enqueue(encoder.encode(JSON.stringify({ type: "error", stage: "save", message: String(e) }) + "\n"));
        }
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache, no-transform" },
  });
}
