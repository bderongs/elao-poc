import { computeCompositeCefrScore } from "@/lib/cefr-score";
import { globalScoreByModel, latestEvaluationResult, LIVE_CONVERSATION_MODEL_ID } from "@/lib/cefr-eval";
import {
  pronunciationScoreByProvider,
  pronunciationAvgAttribution,
  liveConversationPronunciationProviderId,
} from "@/lib/pronunciation-rollup";
import type { CefrResult, EvaluationRow, TurnEvaluationRow, SessionDetailRow } from "@/lib/types";

export interface ScoreRow {
  id: string;
  label: string;
  score: number | null;
}

export interface ConfidenceRow {
  id: string;
  label: string;
  confidence: "high" | "medium" | "low" | null;
}

export interface ScoreCategory {
  rows: ScoreRow[];
  /** Row id whose value is the one actually shown in the headline CefrPanel above. */
  currentId: string | null;
}

export interface ScoreBreakdown {
  cefrSourceId: string | null;
  cefrSourceLabel: string | null;
  /** Null when pronunciation numbers come from more than one provider (see pronunciationSourceLabel). */
  pronunciationSourceId: string | null;
  pronunciationSourceLabel: string | null;
  global: ScoreCategory;
  confidence: { rows: ConfidenceRow[]; currentId: string | null };
  pronunciation: ScoreCategory;
  fluency: ScoreCategory;
  vocabGrammar: ScoreCategory;
  communication: ScoreCategory;
}

interface ProviderOption {
  id: string;
  label: string;
}

type Dimension = "fluency" | "vocabulary_grammar" | "communication";

/**
 * Every category from /admin/scoring (Global, Confidence, Pronunciation,
 * Fluency, Vocab & Gram., Communication), one row per registered LLM/
 * pronunciation provider, so components/ScoreBreakdownPanel.tsx can show
 * "here's the value you're looking at, and here's what every other model/
 * provider says" for each of them.
 *
 * Model/provider-scoped lookups (globalScoreByModel, latestEvaluationResult,
 * pronunciationScoreByProvider) only read the eval-lab/pronunciation-lab
 * tables — empty for a conversation session that's never been replayed
 * through either lab, even though the headline card is clearly showing a
 * value from the live flow's own cache (session.evaluation_json /
 * session.pronunciation_scores). Every category here prefers that displayed
 * value for whichever model/provider is actually attributed as "current" and
 * only falls back to the lab tables for every other row — so the row
 * matching what's on screen is never wrongly labeled "not yet run".
 */
export function buildScoreBreakdown(params: {
  session: SessionDetailRow;
  cefrResult: CefrResult | null;
  evaluations: EvaluationRow[];
  turnEvaluations: TurnEvaluationRow[];
  providerOptions: ProviderOption[];
  pronunciationProviderOptions: ProviderOption[];
}): ScoreBreakdown {
  const { session, cefrResult, evaluations, turnEvaluations, providerOptions, pronunciationProviderOptions } = params;
  const pronunciationAvg = session.pronunciation_scores;

  const latestEvalRow = evaluations.find((e) => !e.error && e.result_json) ?? null;
  const cefrSourceId = session.evaluation_json ? LIVE_CONVERSATION_MODEL_ID : latestEvalRow?.model_id ?? null;
  const cefrSourceLabel = cefrSourceId
    ? providerOptions.find((p) => p.id === cefrSourceId)?.label ?? cefrSourceId
    : null;

  const pronunciationProviderIds =
    session.source === "conversation"
      ? session.pronunciation_scores
        ? [liveConversationPronunciationProviderId(session.language)]
        : []
      : pronunciationAvgAttribution(turnEvaluations)?.providerIds ?? [];
  const pronunciationSourceId = pronunciationProviderIds.length === 1 ? pronunciationProviderIds[0] : null;
  const pronunciationSourceLabel =
    pronunciationProviderIds.length === 1
      ? pronunciationProviderOptions.find((p) => p.id === pronunciationProviderIds[0])?.label ?? pronunciationProviderIds[0]
      : pronunciationProviderIds.length > 1
      ? "Mixed providers"
      : null;

  const globalRows: ScoreRow[] = providerOptions.map((p) => ({
    id: p.id,
    label: p.label,
    score:
      p.id === cefrSourceId && cefrResult
        ? computeCompositeCefrScore(cefrResult, pronunciationAvg).score
        : globalScoreByModel(evaluations, p.id, pronunciationAvg),
  }));

  const confidenceRows: ConfidenceRow[] = providerOptions.map((p) => ({
    id: p.id,
    label: p.label,
    confidence:
      p.id === cefrSourceId && cefrResult
        ? cefrResult.confidence
        : latestEvaluationResult(evaluations, p.id)?.confidence ?? null,
  }));

  const dimensionRows = (dimension: Dimension): ScoreRow[] =>
    providerOptions.map((p) => {
      const raw =
        p.id === cefrSourceId && cefrResult
          ? cefrResult.dimensions[dimension]
          : latestEvaluationResult(evaluations, p.id)?.dimensions[dimension] ?? null;
      // Dimensions are 0-10; scale to 0-100 so every category shares one
      // scale and ComparisonTable's ScorePill/diffColor thresholds apply uniformly.
      return { id: p.id, label: p.label, score: raw != null ? raw * 10 : null };
    });

  // For a conversation session's single attributed provider,
  // pronunciation_scores IS the authoritative live number —
  // recomputeSessionRollup no-ops for conversation sessions, so an ad-hoc
  // single-turn lab rerun never feeds back into it and
  // pronunciationScoreByProvider could disagree with what's actually
  // displayed above.
  const pronunciationRows: ScoreRow[] = pronunciationProviderOptions.map((p) => ({
    id: p.id,
    label: p.label,
    score:
      session.source === "conversation" && p.id === pronunciationSourceId && pronunciationAvg
        ? pronunciationAvg.pronunciation
        : pronunciationScoreByProvider(turnEvaluations, p.id),
  }));

  return {
    cefrSourceId,
    cefrSourceLabel,
    pronunciationSourceId,
    pronunciationSourceLabel,
    global: { rows: globalRows, currentId: cefrSourceId },
    confidence: { rows: confidenceRows, currentId: cefrSourceId },
    pronunciation: { rows: pronunciationRows, currentId: pronunciationSourceId },
    fluency: { rows: dimensionRows("fluency"), currentId: cefrSourceId },
    vocabGrammar: { rows: dimensionRows("vocabulary_grammar"), currentId: cefrSourceId },
    communication: { rows: dimensionRows("communication"), currentId: cefrSourceId },
  };
}
