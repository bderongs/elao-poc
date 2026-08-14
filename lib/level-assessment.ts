/**
 * ET — Evaluation Transcription: a small, fast, text-only judgment of how the
 * speaker handled ONE question, used purely to steer the difficulty rung of
 * the NEXT question. This is deliberately NOT a precise assessment (that's
 * lib/cefr-prompt.ts's job at session end, and lib/pronunciation/providers/
 * voxtral.ts's job for pronunciation) — just a quick pacing signal, split out
 * of what used to be inline reasoning inside the conversation call itself
 * (app/api/chat/route.ts) so that call can be "just" about answering, and so
 * this call can run non-blocking in parallel instead of adding its own
 * reasoning cost to every reply.
 *
 * Called from app/api/assess-transcript/route.ts, fired by the client as
 * soon as STT finalizes an answer — best-effort: app/page.tsx uses whatever
 * the LATEST completed result is when the next conversation call goes out,
 * never blocks on this finishing in time.
 */

import { mistralComplete, mistralChatModel } from "@/lib/mistral";
import { logServerEvent } from "@/lib/server-log";
import type { ConvLang } from "@/lib/conversation-prompts";
import { CEFR_LADDER, type CefrRung } from "@/lib/cefr-rung";

/** Mirrors the step logic that used to live inline in the conversation prompt's
 *  ADAPTIVE DIFFICULTY rule: stepSize rungs per turn (admin-configurable, see
 *  lib/conversation-settings-service.ts — defaults to 1), clamped to the ladder ends. */
function stepRung(current: CefrRung, verdict: string, stepSize: number): CefrRung {
  const i = CEFR_LADDER.indexOf(current);
  if (verdict === "well") return CEFR_LADDER[Math.min(i + stepSize, CEFR_LADDER.length - 1)];
  if (verdict === "struggled") return CEFR_LADDER[Math.max(i - stepSize, 0)];
  return current; // "adequate", or an unrecognized verdict — hold position
}

const SYSTEM_PROMPT = `You are a fast pacing judge for a spoken-language oral exam — NOT the final assessment, just a quick per-turn signal for how hard the NEXT question should be.

Given the question asked and the speaker's answer (transcribed by speech recognition — expect minor recognition noise, don't penalise obvious ASR artefacts), judge how they handled THIS question at the CURRENT rung:
- "well": relevant, developed beyond one clause, grammar/vocab adequate for the rung, understood the question first time.
- "adequate": meaning clear but short, hesitant, simple structures, or a minor comprehension wobble.
- "struggled": very short or off-topic, errors block meaning, needed the question repeated, fell back to another language, or near-silence.

Return ONLY JSON, no markdown fences: {"verdict": "well"|"adequate"|"struggled"}`;

export async function assessTranscript(params: {
  language: ConvLang;
  questionAsked: string;
  userAnswer: string;
  currentRung: CefrRung;
  turnLogId: string;
  process: string;
  stepSize: number;
}): Promise<{ nextRung: CefrRung; verdict: string } | null> {
  try {
    const raw = await mistralComplete({
      model: mistralChatModel(),
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Current rung: ${params.currentRung}\nQuestion asked: "${params.questionAsked}"\nSpeaker's answer: "${params.userAnswer}"`,
        },
      ],
      maxTokens: 50,
      json: true,
      context: params.process,
    });
    const cleaned = raw.trim().replace(/^```json\s*|\s*```$/g, "").trim();
    const parsed = JSON.parse(cleaned) as { verdict?: string };
    const verdict = parsed.verdict ?? "adequate";
    const nextRung = stepRung(params.currentRung, verdict, params.stepSize);
    return { nextRung, verdict };
  } catch (e) {
    logServerEvent("et_failed", { turnLogId: params.turnLogId, process: params.process, error: String(e) });
    return null;
  }
}
