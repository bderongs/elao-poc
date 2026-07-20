import type { PronunciationResult } from "@/lib/azure-stt";

// Domain types shared across API routes, the admin tool, and the eval lab —
// single source of truth so route handlers and pages don't redeclare the
// same shape independently.

export interface CefrResult {
  candidate: string;
  language: string;
  level: string;
  score_percent: number;
  confidence: "high" | "medium" | "low";
  dimensions: {
    fluency: number | null;
    vocabulary_grammar: number | null;
    communication: number | null;
  };
  strengths: string[];
  areas_for_improvement: string[];
  notable_errors: string[];
  summary: string;
}

export interface AzureAvg {
  pronunciation: number;
  wpm: number;
  score: number;
  count: number;
  /** Turns with < 6 words — each deducts 0.5 from the fluency dimension. */
  shortTurns: number;
}

export interface SessionSummary {
  id: string;
  created_at: string;
  language: string | null;
  cefr_level: string | null;
  global_score: number | null;
  duration_seconds: number | null;
}

export interface SessionDetailRow extends SessionSummary {
  audio_url: string | null;
  evaluation_json: CefrResult | null;
  azure_scores: AzureAvg | null;
}

export interface TurnRow {
  id: string;
  turn_index: number;
  role: "user" | "assistant";
  content: string;
  audio_url: string | null;
  pronunciation_json: PronunciationResult | null;
}

export interface EvaluationRow {
  id: string;
  model_id: string;
  prompt_version: string;
  result_json: CefrResult | null;
  error: string | null;
  duration_ms: number | null;
  created_at: string;
}
