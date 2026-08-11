import type { CefrResult, PronunciationAvg, SpeechaceScores } from "@/lib/types";

/** Derive CEFR level from composite score (5-point bands). */
export function scoreToLevel(score: number): string {
  if (score >= 90) return "C2";
  if (score >= 85) return "C1+";
  if (score >= 80) return "C1";
  if (score >= 75) return "B2+";
  if (score >= 70) return "B2";
  if (score >= 65) return "B1+";
  if (score >= 60) return "B1";
  if (score >= 55) return "A2+";
  if (score >= 50) return "A2";
  if (score >= 45) return "A1+";
  if (score >= 40) return "A1";
  return "A0";
}

export interface CompositeCefrScore {
  score: number;
  level: string;
}

/**
 * "Our" global score for a session: the CEFR evaluator's holistic
 * score_percent, with a +5% excellence bonus when at least 2 of the 4
 * dimensions (pronunciation from our own audio engine, fluency/
 * vocabulary_grammar/communication from the LLM) reach 9/10 — two standout
 * dimensions signal a stronger candidate than a flat profile at the same
 * average. Single source of truth for "our global score", shared by the
 * live CefrPanel display and the Speechace comparison — anywhere the app
 * needs to say "here is our one overall number" it should call this rather
 * than reading `result.score_percent` directly, which is the LLM's number
 * alone and doesn't account for our own measured pronunciation.
 */
export function computeCompositeCefrScore(result: CefrResult, pronunciationAvg: PronunciationAvg | null): CompositeCefrScore {
  const pronScore = pronunciationAvg ? pronunciationAvg.pronunciation / 10 : null;
  const fluency = result.dimensions.fluency;
  const vocabGram = result.dimensions.vocabulary_grammar;
  const comm = result.dimensions.communication;

  const baseScore = result.score_percent;
  const highCount = [pronScore, fluency, vocabGram, comm].filter(
    (v): v is number => v !== null && v >= 9,
  ).length;
  const score = highCount >= 2 ? Math.min(100, Math.round(baseScore * 1.05)) : baseScore;
  const level = score !== baseScore ? scoreToLevel(score) : (result.level ?? scoreToLevel(score));
  return { score, level };
}

export interface SessionMainScore extends CompositeCefrScore {
  /** Which stored field the number came from — lets the UI label it honestly. */
  source: "cefr" | "speechace" | "pronunciation";
}

interface ScorableSession {
  cefr_level: string | null;
  global_score: number | null;
  evaluation_json: CefrResult | null;
  pronunciation_scores: PronunciationAvg | null;
  speechace_scores: SpeechaceScores | null;
  /**
   * Fallback for upload/Speechace-import sessions: `evaluation_json` is only
   * ever written by the live conversation flow, so those sessions have no
   * CEFR result there even after being run through the eval lab — the
   * result lives in `session_evaluations` instead. `listSessions` resolves
   * "latest successful eval-lab run" the same way the detail page does
   * (see app/admin/(dashboard)/[id]/page.tsx) and attaches it here, so a
   * session shows the same "our score" in both places instead of the list
   * silently having none.
   */
  latest_eval_json?: CefrResult | null;
}

function resolveCefrResult(session: ScorableSession): CefrResult | null {
  return session.evaluation_json ?? session.latest_eval_json ?? null;
}

/**
 * The one headline number for a session row, picked from whichever score
 * field is actually populated for that session's source (see
 * SESSION_SUMMARY_COLUMNS): a live conversation has evaluation_json, an
 * uploaded recording may only have pronunciation_scores, a Speechace import
 * only has speechace_scores. Returns null when nothing has been scored yet.
 */
export function computeSessionMainScore(session: ScorableSession): SessionMainScore | null {
  const cefrResult = resolveCefrResult(session);
  if (cefrResult) {
    return { ...computeCompositeCefrScore(cefrResult, session.pronunciation_scores), source: "cefr" };
  }
  if (session.global_score != null && session.cefr_level) {
    return { score: session.global_score, level: session.cefr_level, source: "cefr" };
  }
  if (session.speechace_scores?.overall != null) {
    const score = Math.round(session.speechace_scores.overall);
    return { score, level: scoreToLevel(score), source: "speechace" };
  }
  if (session.pronunciation_scores?.score != null) {
    const score = Math.round(session.pronunciation_scores.score);
    return { score, level: scoreToLevel(score), source: "pronunciation" };
  }
  return null;
}

export interface ScoreBreakdownRow {
  label: string;
  value: number;
  max: number;
}

export interface ScoreBreakdownGroup {
  title: string;
  rows: ScoreBreakdownRow[];
}

interface DimensionScore {
  /** Which engine produced this number — the row label, so same-dimension scores read as a direct comparison. */
  source: string;
  value: number;
}

/**
 * Every score we hold for a session, grouped by source (Ours/Speechace) —
 * for the session LIST page's hover popover (components/SessionScoreCell.tsx).
 * "Global" (the one holistic number per source) and "Pronunciation" (the one
 * pronunciation-engine number per source) — not a per-dimension breakdown.
 * The session DETAIL page's per-category breakdown lives in
 * lib/score-breakdown.ts instead.
 * `pronunciation_scores.score` is deliberately not a third "global" source:
 * it's literally `Math.round(pronunciation_scores.pronunciation)` (see
 * lib/pronunciation-rollup.ts's computePronunciationAvg), i.e. the same
 * pronunciation number again, not a distinct construct.
 */
export function sessionScoreBreakdown(session: ScorableSession): ScoreBreakdownGroup[] {
  const cefrResult = resolveCefrResult(session);
  const global: DimensionScore[] = [];
  const pronunciation: DimensionScore[] = [];

  if (cefrResult) {
    const { score } = computeCompositeCefrScore(cefrResult, session.pronunciation_scores);
    global.push({ source: "Ours", value: score });
  }
  if (session.speechace_scores?.overall != null) {
    global.push({ source: "Speechace", value: session.speechace_scores.overall });
  }

  if (session.pronunciation_scores) {
    pronunciation.push({ source: "Ours", value: session.pronunciation_scores.pronunciation });
  }
  if (session.speechace_scores?.pronunciation != null) {
    pronunciation.push({ source: "Speechace", value: session.speechace_scores.pronunciation });
  }

  const toGroup = (title: string, scores: DimensionScore[]): ScoreBreakdownGroup | null =>
    scores.length ? { title, rows: scores.map((s) => ({ label: s.source, value: s.value, max: 100 })) } : null;

  return [toGroup("Global", global), toGroup("Pronunciation", pronunciation)].filter(
    (g): g is ScoreBreakdownGroup => g !== null,
  );
}
