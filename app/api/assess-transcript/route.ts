/**
 * ET — Evaluation Transcription endpoint. Thin wrapper around the ET
 * provider registry (lib/et/registry.ts) — same pattern as pronunciation/
 * STT/CEFR-eval — called by app/page.tsx immediately when STT finalizes a
 * user turn (non-blocking — the client never awaits this before firing the
 * next conversation call, it just uses whatever the latest completed result is).
 */

import { getProvider, LIVE_ET_PROVIDER_ID } from "@/lib/et/registry";
import { isCefrRung, type CefrRung } from "@/lib/cefr-rung";
import type { ConvLang } from "@/lib/conversation-prompts";

export const runtime = "nodejs";

interface AssessRequest {
  language: ConvLang;
  questionAsked: string;
  userAnswer: string;
  currentRung: CefrRung;
  turnLogId: string;
  /** Rungs to move per well/struggled verdict — admin-configurable, see
   *  lib/conversation-settings-service.ts. Defaults to 1 if missing/invalid. */
  stepSize?: number;
}

function clampStepSize(value: unknown): number {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 4 ? (value as number) : 1;
}

export async function POST(req: Request) {
  const { language, questionAsked, userAnswer, currentRung, turnLogId, stepSize } =
    (await req.json()) as AssessRequest;

  if (!isCefrRung(currentRung) || !userAnswer.trim()) {
    return Response.json({ nextRung: isCefrRung(currentRung) ? currentRung : "A2", verdict: "skipped" });
  }

  const result = await getProvider(LIVE_ET_PROVIDER_ID).assess({
    language,
    questionAsked,
    userAnswer,
    currentRung,
    turnLogId,
    stepSize: clampStepSize(stepSize),
  });

  if (!result) {
    // Best-effort: hold the current rung rather than fail the caller.
    return Response.json({ nextRung: currentRung, verdict: "unavailable" });
  }

  return Response.json(result);
}
