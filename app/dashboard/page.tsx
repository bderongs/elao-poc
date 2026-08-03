import Link from "next/link";
import { getCurrentUser } from "@/lib/current-user";
import { listSessions } from "@/lib/sessions-service";
import { SessionScoreCell } from "@/components/SessionScoreCell";
import { formatDateTime } from "@/lib/format-date";
import { languageLabel, languageFlag } from "@/lib/languages";
import adminStyles from "@/components/admin.module.css";
import styles from "@/components/dashboard.module.css";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 9;

function PageLink({ page, disabled, children }: { page: number; disabled: boolean; children: React.ReactNode }) {
  if (disabled) {
    return <span className={adminStyles.pageLinkDisabled}>{children}</span>;
  }
  return (
    <Link href={`/dashboard?page=${page}`} className={adminStyles.pageLink}>
      {children}
    </Link>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const user = await getCurrentUser();
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);

  // Layout already redirects to /login when there's no user; user! is safe here.
  const { sessions, total } = await listSessions({ page, pageSize: PAGE_SIZE, userId: user!.id });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <div className={styles.hero}>
        <div className={styles.heroEmoji}>🎙️</div>
        <h1 className={styles.heroTitle}>Bonjour {user!.email}</h1>
        <p className={styles.heroSubtitle}>Passe un nouveau test ou retrouve tes résultats précédents.</p>
        <Link href="/" className={styles.heroCta}>
          ▶ Passer un nouveau test
        </Link>
      </div>

      <h2 className={styles.sectionTitle}>Mes sessions ({total})</h2>

      {sessions.length === 0 ? (
        <div className={adminStyles.emptyState}>Aucune session pour l&apos;instant — lance ton premier test !</div>
      ) : (
        <>
          <div className={styles.grid}>
            {sessions.map((s) => (
              <Link key={s.id} href={`/dashboard/${s.id}`} className={styles.sessionCard}>
                <div className={styles.sessionCardHeader}>
                  <div>
                    <div className={styles.sessionDate}>{formatDateTime(s.created_at)}</div>
                    <div className={styles.sessionLanguage}>
                      {languageFlag(s.language)} {languageLabel(s.language)}
                    </div>
                  </div>
                  <SessionScoreCell session={s} />
                </div>
                <div className={styles.sessionMeta}>
                  {s.duration_seconds ? `${Math.round(s.duration_seconds / 60)} min` : "—"}
                </div>
              </Link>
            ))}
          </div>

          <div className={adminStyles.pagination}>
            <span className={adminStyles.pageInfo}>
              Page {page} / {totalPages}
            </span>
            <div className={adminStyles.pageLinks}>
              <PageLink page={page - 1} disabled={page <= 1}>&larr; Précédent</PageLink>
              <PageLink page={page + 1} disabled={page >= totalPages}>Suivant &rarr;</PageLink>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
