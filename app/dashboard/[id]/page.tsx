import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { getSessionDetail } from "@/lib/sessions-service";
import { getLevelFloors } from "@/lib/scoring-settings-service";
import { ensureFrenchAnalysis } from "@/lib/analysis-translation";
import { CefrPanel, UserWords, UtteranceBadges } from "@/components/ScoreDisplay";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { AudioPlayer } from "@/components/AudioPlayer";
import { formatDateTime } from "@/lib/format-date";
import { languageLabel, languageFlag } from "@/lib/languages";
import adminStyles from "@/components/admin.module.css";
import { getUiServer } from "@/lib/ui-lang-server";
import { AVATAR_NAME } from "@/lib/session-config";
import styles from "@/components/dashboard.module.css";

export const dynamic = "force-dynamic";


export default async function DashboardSessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) notFound(); // defensive; app/dashboard/layout.tsx already guarantees a user

  const detail = await getSessionDetail(id);
  // A session that doesn't exist and one that exists but belongs to someone
  // else both 404 — a 403 would leak which session ids are real.
  if (!detail || detail.session.user_id !== user.id) notFound();

  const { session, turns, evaluations } = detail;
  const levelFloors = await getLevelFloors();
  const { lang, t } = await getUiServer();
  const evalRow = session.evaluation_json ? null : evaluations.find((e) => !e.error && e.result_json) ?? null;
  const storedResult = session.evaluation_json ?? evalRow?.result_json ?? null;
  // Evaluations from before the French feedback existed are translated (and saved) on first view.
  const cefrResult = storedResult
    ? await ensureFrenchAnalysis({ sessionId: session.id, result: storedResult, evaluationRowId: evalRow?.id })
    : null;

  return (
    <div>
      <Link href="/dashboard" className={styles.backLink}>
        {t.dashboard.back}
      </Link>

      <div className={adminStyles.detailHeaderRow}>
        <h1 className={styles.detailTitle}>
          {languageFlag(session.language)} {languageLabel(session.language)} · {formatDateTime(session.created_at)}
        </h1>
      </div>
      <div className={adminStyles.detailMeta}>
        {t.dashboard.duration} : {session.duration_seconds ? `${Math.round(session.duration_seconds / 60)} min` : "—"}
      </div>

      {session.audio_url && (
        <div className={adminStyles.audioBlock}>
          <div className={adminStyles.audioLabel}>{t.dashboard.fullRecording}</div>
          <AudioPlayer src={session.audio_url} />
        </div>
      )}

      {cefrResult ? (
        <div className={adminStyles.scoreCardWrap}>
          <CefrPanel result={cefrResult} pronunciationAvg={session.pronunciation_scores} labels={t.cefr} theme="light" levelFloors={levelFloors} feedbackLanguage={lang === "fr" ? "fr" : "en"} />
        </div>
      ) : (
        <div className={adminStyles.emptyState}>{t.dashboard.noEvaluation}</div>
      )}

      <div style={{ marginTop: 24 }}>
        <CollapsibleSection title={t.dashboard.transcript}>
          <div className={adminStyles.turnList}>
            {turns.map((turn) => (
              <div
                key={turn.id}
                className={`${adminStyles.turnCard} ${turn.role === "user" ? adminStyles.turnCardUser : adminStyles.turnCardAssistant}`}
              >
                <div className={adminStyles.turnMeta}>
                  {turn.role === "user" ? t.transcript.you : AVATAR_NAME} · {t.dashboard.turn(turn.turn_index + 1)}
                </div>
                <div className={adminStyles.turnText}>
                  {turn.role === "user" && turn.pronunciation_json?.words?.length ? (
                    <UserWords words={turn.pronunciation_json.words} />
                  ) : (
                    turn.content
                  )}
                </div>
                {turn.role === "user" && turn.pronunciation_json && <UtteranceBadges p={turn.pronunciation_json} />}
                {turn.role === "user" && turn.audio_url && <AudioPlayer src={turn.audio_url} compact />}
              </div>
            ))}
          </div>
        </CollapsibleSection>
      </div>
    </div>
  );
}
