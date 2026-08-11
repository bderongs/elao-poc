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

export interface PronunciationAvg {
  pronunciation: number;
  wpm: number;
  score: number;
  count: number;
  /** Turns with < 6 words — each deducts 0.5 from the fluency dimension. */
  shortTurns: number;
}

/** Session-level scores as Speechace reports them, translated to our 0-100 scale — no per-turn breakdown, by design. */
export interface SpeechaceScores {
  fluency: number | null;
  pronunciation: number | null;
  overall: number | null;
}

export interface SessionSummary {
  id: string;
  created_at: string;
  language: string | null;
  cefr_level: string | null;
  global_score: number | null;
  duration_seconds: number | null;
  /** 'conversation' = real live session, 'upload' = created from an uploaded audio file, 'speechace' = imported from a competitor report. */
  source: "conversation" | "upload" | "speechace";
  /** Present only for 'conversation' sessions — the live flow is the only writer of this column. */
  evaluation_json: CefrResult | null;
  pronunciation_scores: PronunciationAvg | null;
  speechace_scores: SpeechaceScores | null;
  /** listSessions-only: latest successful eval-lab run, for sessions where evaluation_json is empty — see lib/cefr-score.ts's resolveCefrResult. */
  latest_eval_json?: CefrResult | null;
  /** Owning account, set by claimSession(); null until claimed (or for admin-created upload/speechace sessions). */
  user_id: string | null;
}

export interface SessionDetailRow extends SessionSummary {
  audio_url: string | null;
  source_url: string | null;
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

export interface TurnEvaluationRow {
  id: string;
  turn_id: string;
  provider_id: string;
  result_json: PronunciationResult | null;
  error: string | null;
  duration_ms: number | null;
  created_at: string;
}

export interface UserRow {
  id: string;
  email: string | null;
  role: "user" | "admin";
  displayName: string | null;
  createdAt: string;
  /** Count of sessions with sessions.user_id = this account — 0 means "signed up, never claimed/took a test". */
  sessionCount: number;
}
