import Link from "next/link";
import { notFound } from "next/navigation";
import { getSessionDetail } from "@/lib/sessions-service";
import { CefrPanel, UserWords, UtteranceBadges, wordColor } from "@/components/ScoreDisplay";
import { EvalLabPanel } from "@/components/EvalLabPanel";
import { listProviders } from "@/lib/llm/registry";
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

  const { session, turns, evaluations } = detail;
  const providerOptions = listProviders().map((p) => ({ id: p.id, label: p.label }));

  return (
    <div>
      <Link href="/admin" className={styles.backLink}>
        &larr; All sessions
      </Link>

      <div className={styles.detailGrid}>
        <div>
          <div className={styles.detailHeaderRow}>
            <h1 className={styles.pageTitle} style={{ marginBottom: 0 }}>
              {session.language ?? "—"} · {new Date(session.created_at).toLocaleString()}
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

          {session.audio_url && (
            <div className={styles.audioBlock}>
              <div className={styles.audioLabel}>Full session recording</div>
              <audio controls src={session.audio_url} style={{ width: "100%" }} />
            </div>
          )}

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
                {t.role === "user" && t.audio_url && (
                  <audio controls src={t.audio_url} style={{ width: "100%", marginTop: 6, height: 30 }} />
                )}
              </div>
            ))}
          </div>
        </div>

        <div>
          {session.evaluation_json ? (
            <CefrPanel result={session.evaluation_json} azureAvg={session.azure_scores} />
          ) : (
            <div className={styles.emptyState}>No evaluation recorded for this session.</div>
          )}
        </div>
      </div>

      <EvalLabPanel sessionId={session.id} providers={providerOptions} initialEvaluations={evaluations} />
    </div>
  );
}
