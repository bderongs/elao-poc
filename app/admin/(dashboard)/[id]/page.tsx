import Link from "next/link";
import { notFound } from "next/navigation";
import { getSessionDetail } from "@/lib/sessions-service";
import { CefrPanel, UserWords, UtteranceBadges, wordColor } from "@/components/ScoreDisplay";
import { PronunciationLabPanel } from "@/components/PronunciationLabPanel";
import { SttLabPanel } from "@/components/SttLabPanel";
import { AddRecordingButton } from "@/components/AddRecordingButton";
import { RunEvaluationGear } from "@/components/RunEvaluationGear";
import { ScoreBreakdownPanel } from "@/components/ScoreBreakdownPanel";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { AudioPlayer } from "@/components/AudioPlayer";
import { ProviderConfigTable } from "@/components/ProviderConfigTable";
import { listProviders } from "@/lib/llm/registry";
import { listProviders as listPronunciationProviders } from "@/lib/pronunciation/registry";
import { buildScoreBreakdown } from "@/lib/score-breakdown";
import {
  pronunciationProviderFullyCovered,
  pronunciationProviderPending,
  liveConversationPronunciationProviderId,
} from "@/lib/pronunciation-rollup";
import { latestEvaluationResult, isEvalProviderPending, LIVE_CONVERSATION_MODEL_ID } from "@/lib/cefr-eval";
import { formatDateTime } from "@/lib/format-date";
import styles from "@/components/admin.module.css";

export const dynamic = "force-dynamic";

export default async function AdminSessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const detail = await getSessionDetail(id);
  if (!detail) notFound();

  const { session, turns, evaluations, turnEvaluations } = detail;
  const providerOptions = listProviders().map((p) => ({ id: p.id, label: p.label }));
  const pronunciationProviderOptions = listPronunciationProviders().map((p) => ({ id: p.id, label: p.label }));

  // For upload/speechace sessions, `evaluation_json` is never populated (only
  // the live conversation flow writes it) — fall back to the latest eval-lab
  // run so "our own CEFR assessment" still has something to show.
  const cefrResult =
    session.evaluation_json ?? evaluations.find((e) => !e.error && e.result_json)?.result_json ?? null;

  const breakdown = buildScoreBreakdown({
    session,
    cefrResult,
    evaluations,
    turnEvaluations,
    providerOptions,
    pronunciationProviderOptions,
  });

  const turnsWithAudioIds = turns.filter((t) => t.audio_url).map((t) => t.id);
  const canRunBatchEvaluation = turnsWithAudioIds.length > 0;

  // This session's language decides which pronunciation provider is "the
  // live one" (LIVE_CONVERSATION_PRONUNCIATION_PROVIDER_BY_LANG in
  // lib/pronunciation-rollup.ts — Voxtral for en/fr, azure-ensemble for the
  // rest), since that's no longer a single global id.
  const livePronunciationProviderId = liveConversationPronunciationProviderId(session.language);

  // Every provider call is a fresh, paid API request with no caching (see
  // lib/pronunciation/assess.ts) — surface which providers already have a
  // complete score for this session so the gear doesn't invite re-billing
  // for results we already have. A live conversation session's live
  // pronunciation score and mistral CEFR eval come from the live flow itself
  // (session.pronunciation_scores / session.evaluation_json), never from the
  // session_turn_evaluations/session_evaluations lab tables — same
  // attribution gap buildScoreBreakdown already accounts for above.
  const alreadyScoredPronunciationIds = pronunciationProviderOptions
    .filter(
      (p) =>
        (session.source === "conversation" &&
          p.id === livePronunciationProviderId &&
          session.pronunciation_scores != null) ||
        pronunciationProviderFullyCovered(turnEvaluations, p.id, turnsWithAudioIds)
    )
    .map((p) => p.id);
  const alreadyScoredEvalIds = providerOptions
    .filter(
      (p) =>
        (session.source === "conversation" && p.id === LIVE_CONVERSATION_MODEL_ID && session.evaluation_json != null) ||
        latestEvaluationResult(evaluations, p.id) != null
    )
    .map((p) => p.id);

  // A run that's been launched but hasn't finished yet — see the pending
  // placeholder rows written by assessTurn()/runCefrEvaluation(). Lets the
  // gear show "running" instead of nothing after a launch + refresh.
  const pendingPronunciationIds = pronunciationProviderOptions
    .filter((p) => pronunciationProviderPending(turnEvaluations, p.id, turnsWithAudioIds))
    .map((p) => p.id);
  const pendingEvalIds = providerOptions
    .filter((p) => isEvalProviderPending(evaluations, p.id))
    .map((p) => p.id);

  // Whether a fresh live-pronunciation-provider (see livePronunciationProviderId
  // above) lab re-run exists for every recorded turn — i.e. there's something
  // to promote over the live flow's original pronunciation_scores (see
  // PromoteHeadlineButton / promoteConversationRollup).
  const canPromoteHeadline =
    session.source === "conversation" &&
    pronunciationProviderFullyCovered(turnEvaluations, livePronunciationProviderId, turnsWithAudioIds);

  return (
    <div>
      <Link href="/admin" className={styles.backLink}>
        &larr; All sessions
      </Link>

      <div className={styles.detailHeaderRow}>
        <h1 className={styles.pageTitle} style={{ marginBottom: 0 }}>
          {session.language ?? "—"} · {formatDateTime(session.created_at)}
        </h1>
        {session.cefr_level && (
          <span className={styles.badge} style={{ background: wordColor(session.global_score ?? 0) }}>
            {session.cefr_level}
          </span>
        )}
      </div>
      <div className={styles.detailMeta}>
        Duration: {session.duration_seconds ? `${Math.round(session.duration_seconds / 60)} min` : "—"}
      </div>

      {session.source === "speechace" && session.source_url && (
        <div className={styles.detailMeta}>
          <a href={session.source_url} target="_blank" rel="noreferrer">
            View original Speechace report ↗
          </a>
        </div>
      )}

      {session.audio_url && (
        <div className={styles.audioBlock}>
          <div className={styles.audioLabel}>Full session recording</div>
          <AudioPlayer src={session.audio_url} />
        </div>
      )}

      {cefrResult ? (
        <div className={styles.scoreCardWrap}>
          <CefrPanel
            result={cefrResult}
            pronunciationAvg={session.pronunciation_scores}
            sourceLabel={breakdown.cefrSourceLabel ?? undefined}
            pronunciationSourceLabel={breakdown.pronunciationSourceLabel ?? undefined}
            showDetails={false}
          />
        </div>
      ) : (
        <div className={styles.emptyState}>No evaluation recorded for this session.</div>
      )}

      <ScoreBreakdownPanel
        breakdown={breakdown}
        speechace={session.speechace_scores}
        runControls={
          canRunBatchEvaluation ? (
            <RunEvaluationGear
              sessionId={session.id}
              sessionSource={session.source}
              pronunciationProviders={pronunciationProviderOptions}
              evalProviders={providerOptions}
              alreadyScoredPronunciationIds={alreadyScoredPronunciationIds}
              alreadyScoredEvalIds={alreadyScoredEvalIds}
              pendingPronunciationIds={pendingPronunciationIds}
              pendingEvalIds={pendingEvalIds}
              canPromoteHeadline={canPromoteHeadline}
              livePronunciationProviderId={livePronunciationProviderId}
            />
          ) : undefined
        }
      />

      <div style={{ marginTop: 24 }}>
        <CollapsibleSection title="Configuration used">
          {session.providers_json ? (
            <ProviderConfigTable config={session.providers_json} />
          ) : (
            <div className={styles.emptyState}>
              Not recorded — this session was saved before per-session
              provider tracking existed, or has no live turn pipeline
              (upload/Speechace import).
            </div>
          )}
        </CollapsibleSection>
      </div>

      <div style={{ marginTop: 24 }}>
        <CollapsibleSection title="Transcript">
          <div className={styles.turnList}>
            {turns.map((t) => (
              <div
                key={t.id}
                className={`${styles.turnCard} ${t.role === "user" ? styles.turnCardUser : styles.turnCardAssistant}`}
              >
                <div className={styles.turnMeta}>
                  {t.role} · turn {t.turn_index + 1}
                </div>
                <div className={styles.turnText}>
                  {t.role === "user" && t.pronunciation_json?.words?.length
                    ? <UserWords words={t.pronunciation_json.words} />
                    : t.content}
                </div>
                {t.role === "user" && t.pronunciation_json && <UtteranceBadges p={t.pronunciation_json} />}
                {t.role === "user" && t.audio_url && <AudioPlayer src={t.audio_url} compact />}
                {t.role === "user" && t.audio_url && (
                  <PronunciationLabPanel
                    sessionId={session.id}
                    turnId={t.id}
                    providers={pronunciationProviderOptions}
                    initialEvaluations={turnEvaluations.filter((e) => e.turn_id === t.id)}
                  />
                )}
                {t.role === "user" && t.audio_url && (
                  <SttLabPanel sessionId={session.id} turnId={t.id} originalText={t.content} />
                )}
              </div>
            ))}
          </div>

          <AddRecordingButton sessionId={session.id} />
        </CollapsibleSection>
      </div>
    </div>
  );
}
