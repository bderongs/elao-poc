import Link from "next/link";
import { getCurrentUser } from "@/lib/current-user";
import { listSessions } from "@/lib/sessions-service";
import { getLevelFloors } from "@/lib/scoring-settings-service";
import { SessionScoreCell } from "@/components/SessionScoreCell";
import { formatDateTime } from "@/lib/format-date";
import { languageLabel, languageFlag } from "@/lib/languages";
import { getUiServer } from "@/lib/ui-lang-server";
import styles from "@/components/dashboard.module.css";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 9;

function PageLink({ page, disabled, children }: { page: number; disabled: boolean; children: React.ReactNode }) {
  if (disabled) {
    return <span className={styles.pageLinkDisabled}>{children}</span>;
  }
  return (
    <Link href={`/dashboard?page=${page}`} className={styles.pageLink}>
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
  const levelFloors = await getLevelFloors();
  const { t } = await getUiServer();
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <div className={styles.hero}>
        <h1 className={styles.heroTitle}>{t.dashboard.hello}</h1>
        <p className={styles.heroSubtitle}>{t.dashboard.lead}</p>
        <Link href="/" className={styles.heroCta}>
          {t.dashboard.newTest}
        </Link>
      </div>

      <h2 className={styles.sectionTitle}>{t.dashboard.mySessions} · {total}</h2>

      {sessions.length === 0 ? (
        <div className={styles.empty}>{t.dashboard.empty}</div>
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
                  <SessionScoreCell session={s} levelFloors={levelFloors} />
                </div>
                <div className={styles.sessionMeta}>
                  {s.duration_seconds ? `${Math.round(s.duration_seconds / 60)} min` : "—"}
                </div>
              </Link>
            ))}
          </div>

          <div className={styles.pagination}>
            <span className={styles.pageInfo}>
              {t.dashboard.page} {page} / {totalPages}
            </span>
            <div className={styles.pageLinks}>
              <PageLink page={page - 1} disabled={page <= 1}>{t.dashboard.previous}</PageLink>
              <PageLink page={page + 1} disabled={page >= totalPages}>{t.dashboard.next}</PageLink>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
