import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { getSessionDetail } from "@/lib/sessions-service";
import { CefrPanel, UserWords, UtteranceBadges, type CefrPanelLabels } from "@/components/ScoreDisplay";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { AudioPlayer } from "@/components/AudioPlayer";
import { formatDateTime } from "@/lib/format-date";
import { languageLabel, languageFlag } from "@/lib/languages";
import adminStyles from "@/components/admin.module.css";
import styles from "@/components/dashboard.module.css";

export const dynamic = "force-dynamic";

const FR_LABELS: CefrPanelLabels = {
  eyebrow: "ÉVALUATION ORALE",
  score: "Score",
  strengths: "Points forts",
  toImprove: "À améliorer",
  notableErrors: "Erreurs notables",
  confidence: { high: "ÉLEVÉE", medium: "MOYENNE", low: "FAIBLE" },
};

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
  const cefrResult =
    session.evaluation_json ?? evaluations.find((e) => !e.error && e.result_json)?.result_json ?? null;

  return (
    <div>
      <Link href="/dashboard" className={adminStyles.backLink}>
        &larr; Retour à mes sessions
      </Link>

      <div className={adminStyles.detailHeaderRow}>
        <h1 className={adminStyles.pageTitle} style={{ marginBottom: 0 }}>
          {languageFlag(session.language)} {languageLabel(session.language)} · {formatDateTime(session.created_at)}
        </h1>
      </div>
      <div className={adminStyles.detailMeta}>
        Durée : {session.duration_seconds ? `${Math.round(session.duration_seconds / 60)} min` : "—"}
      </div>

      {session.audio_url && (
        <div className={adminStyles.audioBlock}>
          <div className={adminStyles.audioLabel}>Enregistrement complet</div>
          <AudioPlayer src={session.audio_url} />
        </div>
      )}

      {cefrResult ? (
        <div className={adminStyles.scoreCardWrap}>
          <CefrPanel result={cefrResult} azureAvg={session.azure_scores} labels={FR_LABELS} />
        </div>
      ) : (
        <div className={adminStyles.emptyState}>Aucune évaluation enregistrée pour cette session.</div>
      )}

      <div style={{ marginTop: 24 }}>
        <CollapsibleSection title="Transcription">
          <div className={adminStyles.turnList}>
            {turns.map((t) => (
              <div
                key={t.id}
                className={`${adminStyles.turnCard} ${t.role === "user" ? adminStyles.turnCardUser : adminStyles.turnCardAssistant}`}
              >
                <div className={adminStyles.turnMeta}>
                  {t.role === "user" ? "Toi" : "Assistant"} · tour {t.turn_index + 1}
                </div>
                <div className={adminStyles.turnText}>
                  {t.role === "user" && t.pronunciation_json?.words?.length ? (
                    <UserWords words={t.pronunciation_json.words} />
                  ) : (
                    t.content
                  )}
                </div>
                {t.role === "user" && t.pronunciation_json && <UtteranceBadges p={t.pronunciation_json} />}
                {t.role === "user" && t.audio_url && <AudioPlayer src={t.audio_url} compact />}
              </div>
            ))}
          </div>
        </CollapsibleSection>
      </div>
    </div>
  );
}
