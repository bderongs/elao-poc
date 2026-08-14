import type { ConvLang } from "@/lib/conversation-prompts";
import type { CefrRung } from "@/lib/cefr-rung";

export interface EtAssessParams {
  language: ConvLang;
  questionAsked: string;
  userAnswer: string;
  currentRung: CefrRung;
  turnLogId: string;
  stepSize: number;
}

export interface EtResult {
  nextRung: CefrRung;
  verdict: string;
}

export interface EtProvider {
  id: string;
  label: string;
  /** Human-readable model identifier, shown in the admin system-config page and per-session records. */
  modelLabel: string;
  assess(params: EtAssessParams): Promise<EtResult | null>;
}
