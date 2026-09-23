import { getSystemPrompt, buildQuestionBank, type ConvLang } from "@/lib/conversation-prompts";
import { isCefrRung, type CefrRung } from "@/lib/cefr-rung";
import { OPENER_DOMAINS, isTopicDomain } from "@/lib/topic-domain";

/**
 * Builds the examiner's system prompt for one turn — shared by the live
 * conversation (app/api/chat/route.ts) and the admin conversation simulator
 * (lib/conversation-sim.ts), so the simulator exercises exactly the prompt
 * real users get rather than a copy of it.
 */
export function buildExaminerPrompt(params: {
  language: ConvLang;
  rung?: CefrRung;
  usedQuestions?: string[];
  isStart?: boolean;
  avoidDomain?: string;
  switchToDomain?: string;
}): { system: string; targetRung: CefrRung; updatedUsedQuestions: string[] } {
  const { language, rung, usedQuestions, isStart, avoidDomain, switchToDomain } = params;
  const targetRung: CefrRung = isCefrRung(rung) ? rung : "A2";
  // Picked fresh per session rather than left to the model's own "vary it"
  // judgment — live sessions showed the model defaulting to "where are you
  // from" as the opener nearly every time regardless of that instruction.
  const openerDomain = isStart ? OPENER_DOMAINS[Math.floor(Math.random() * OPENER_DOMAINS.length)] : undefined;
  const promptOpts = {
    ...(isTopicDomain(avoidDomain) ? { avoidDomain } : {}),
    ...(isTopicDomain(avoidDomain) && isTopicDomain(switchToDomain) ? { switchToDomain } : {}),
    ...(openerDomain ? { openerDomain } : {}),
  };
  // Narrow the bank to just this turn's target rung, and track which strings
  // have already been offered this session — Track I-03. Called once, here,
  // so the updatedUsedQuestions echoed back matches exactly what the LLM was
  // shown (calling buildQuestionBank twice would desync them).
  const { bankText, updatedUsedQuestions } = buildQuestionBank(targetRung, usedQuestions ?? []);
  return {
    system: getSystemPrompt(language, targetRung, bankText, promptOpts),
    targetRung,
    updatedUsedQuestions,
  };
}
