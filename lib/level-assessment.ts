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
import { CEFR_LADDER, zoneForRung, type CefrRung } from "@/lib/cefr-rung";
import { isNonComprehension } from "@/lib/comprehension";

/** Mirrors the step logic that used to live inline in the conversation prompt's
 *  ADAPTIVE DIFFICULTY rule: stepSize rungs per turn (admin-configurable, see
 *  lib/conversation-settings-service.ts — defaults to 1), clamped to the ladder ends. */
function stepRung(current: CefrRung, verdict: string, stepSize: number, strong: boolean): CefrRung {
  const i = CEFR_LADDER.indexOf(current);
  // A1/A2: a plain "well" (short but correct) holds the rung — climbing needs "strong".
  if (verdict === "well" && zoneForRung(current) === "foundation" && !strong) return current;
  if (verdict === "well") return CEFR_LADDER[Math.min(i + stepSize, CEFR_LADDER.length - 1)];
  if (verdict === "struggled") return CEFR_LADDER[Math.max(i - stepSize, 0)];
  return current; // "adequate", or an unrecognized verdict — hold position
}

const SYSTEM_PROMPT = `You are a fast pacing judge for a spoken-language oral exam — NOT the final assessment, just a quick per-turn signal for how hard the NEXT question should be.

Given the question asked and the speaker's answer (transcribed by speech recognition — expect minor recognition noise, don't penalise obvious ASR artefacts), judge how they handled THIS question at the CURRENT rung:
- "well": relevant, developed beyond one clause, grammar/vocab adequate for the rung, understood the question first time.
- "adequate": meaning clear but short, hesitant, simple structures, or a minor comprehension wobble.
- "struggled": very short or off-topic, errors block meaning, needed the question repeated, fell back to another language, or near-silence.

Return ONLY JSON, no markdown fences: {"verdict": "well"|"adequate"|"struggled"} — at A1/A2 also include "strong": true|false as described below.`;

// Small, rung-conditional addenda to the base judging criteria above — see
// doc/adaptive-levels-plan.md §3.3. B1/B2/C1 (the tuned, working range) get
// no addendum at all, i.e. the exact behaviour that existed before this.
const FOUNDATION_ADDENDUM = `
At A1/A2, weight comprehension and basic accuracy over elaboration: a short but correct, on-topic answer is "well" for this rung, not "adequate" — a true beginner's short answer is often their ceiling, not hesitation. Reserve "struggled" for answers that are actually off-topic, incomprehensible, or show the question wasn't understood.
Also return "strong": true ONLY when the answer is clearly ABOVE this rung — the question was understood first time (no repeat request, no mother-tongue words), the answer is relevant and goes beyond one short clause (two clauses or more, e.g. a detail, a reason or a second fact), and its grammar is correct for the rung. A short correct answer is "well" with "strong": false. "strong" is only ever true together with verdict "well".`;
const FOUNDATION_STRONG_MIN_WORDS = 6;
const MASTERY_ADDENDUM = `
At C2, the transcript may follow a real thinking pause the speaker took before answering a deliberately hard question — that pause is not part of what you're judging (you only see the text). A precise, well-constructed answer is "well" regardless of how long it took to arrive.`;

function zoneAddendum(rung: CefrRung): string {
  const zone = zoneForRung(rung);
  if (zone === "foundation") return FOUNDATION_ADDENDUM;
  if (zone === "mastery") return MASTERY_ADDENDUM;
  return "";
}

export async function assessTranscript(params: {
  language: ConvLang;
  questionAsked: string;
  userAnswer: string;
  currentRung: CefrRung;
  turnLogId: string;
  process: string;
  stepSize: number;
}): Promise<{ nextRung: CefrRung; verdict: string; strong: boolean } | null> {
  try {
    const raw = await mistralComplete({
      model: mistralChatModel(),
      system: SYSTEM_PROMPT + zoneAddendum(params.currentRung),
      messages: [
        {
          role: "user",
          content: `Current rung: ${params.currentRung}\nQuestion asked: "${params.questionAsked}"\nSpeaker's answer: "${params.userAnswer}"`,
        },
      ],
      maxTokens: 60,
      json: true,
      context: params.process,
    });
    const cleaned = raw.trim().replace(/^```json\s*|\s*```$/g, "").trim();
    const parsed = JSON.parse(cleaned) as { verdict?: string; strong?: boolean };
    const verdict = parsed.verdict ?? "adequate";
    // Code gate on the judge's "strong": never for a very short answer or a "didn't understand".
    const strong =
      parsed.strong === true && verdict === "well" &&
      params.userAnswer.trim().split(/\s+/).length >= FOUNDATION_STRONG_MIN_WORDS &&
      !isNonComprehension(params.userAnswer);
    const nextRung = stepRung(params.currentRung, verdict, params.stepSize, strong);
    return { nextRung, verdict, strong };
  } catch (e) {
    logServerEvent("et_failed", { turnLogId: params.turnLogId, process: params.process, error: String(e) });
    return null;
  }
}
