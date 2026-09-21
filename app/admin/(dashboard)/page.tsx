import Link from "next/link";
import { listSessions } from "@/lib/sessions-service";
import { SessionScoreCell } from "@/components/SessionScoreCell";
import { formatDateTime } from "@/lib/format-date";
import { sessionDisplayStatus } from "@/lib/session-status";
import { adminColors } from "@/lib/admin-theme";
import styles from "@/components/admin.module.css";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

type StatusFilter = "all" | "completed" | "unfinished";
const FILTERS: { id: StatusFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "completed", label: "Completed" },
  { id: "unfinished", label: "Not finished" },
];
const hrefFor = (page: number, status: StatusFilter) => {
  const q = new URLSearchParams();
  if (page > 1) q.set("page", String(page));
  if (status !== "all") q.set("status", status);
  const qs = q.toString();
  return qs ? `/admin?${qs}` : "/admin";
};

function PageLink({ page, status, disabled, children }: { page: number; status: StatusFilter; disabled: boolean; children: React.ReactNode }) {
  if (disabled) {
    return <span className={styles.pageLinkDisabled}>{children}</span>;
  }
  return (
    <Link href={hrefFor(page, status)} className={styles.pageLink}>
      {children}
    </Link>
  );
}

export default async function AdminSessionsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string }>;
}) {
  const { page: pageParam, status: statusParam } = await searchParams;
  const status: StatusFilter = statusParam === "completed" || statusParam === "unfinished" ? statusParam : "all";
  const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);

  let sessions: Awaited<ReturnType<typeof listSessions>>["sessions"] = [];
  let total = 0;
  let loadError: string | null = null;
  try {
    const result = await listSessions({ page, pageSize: PAGE_SIZE, status: status === "all" ? undefined : status });
    sessions = result.sessions;
    total = result.total;
  } catch (e) {
    loadError = String(e);
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <div className={styles.detailHeaderRow} style={{ justifyContent: "space-between" }}>
        <h1 className={styles.pageTitle} style={{ marginBottom: 0 }}>Sessions ({total})</h1>
        <Link href="/admin/upload" className={styles.rowLink}>
          + Upload recording
        </Link>
      </div>

      <div style={{ display: "flex", gap: 12, margin: "0 0 12px", fontSize: 14 }}>
        {FILTERS.map((f) => (
          <Link
            key={f.id}
            href={hrefFor(1, f.id)}
            className={styles.rowLink}
            style={{ fontWeight: f.id === status ? 700 : 400, opacity: f.id === status ? 1 : 0.7 }}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {loadError && <div className={styles.errorBox}>Failed to load sessions: {loadError}</div>}

      {!loadError && sessions.length === 0 && <div className={styles.emptyState}>No sessions yet.</div>}

      {sessions.length > 0 && (
        <>
          <div className={styles.tableCard}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Source</th>
                  <th>Language</th>
                  <th>Score</th>
                  <th>Duration</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id}>
                    <td data-label="Date">
                      <Link href={`/admin/${s.id}`} className={styles.rowLink}>
                        {formatDateTime(s.created_at)}
                      </Link>
                    </td>
                    <td data-label="Source">
                      {s.source === "upload" ? (
                        <span className={styles.badge} style={{ background: "#60a5fa", color: "#000" }}>
                          upload
                        </span>
                      ) : s.source === "speechace" ? (
                        <span className={styles.badge} style={{ background: "#f59e0b", color: "#000" }}>
                          speechace
                        </span>
                      ) : (
                        <span style={{ color: adminColors.muted }}>conversation</span>
                      )}
                    </td>
                    <td data-label="Language">{s.language ?? "—"}</td>
                    <td data-label="Score">
                      <SessionScoreCell session={s} />
                    </td>
                    <td data-label="Duration">
                      {s.duration_seconds ? `${Math.round(s.duration_seconds / 60)} min` : "—"}
                    </td>
                    <td data-label="Status">
                      {(() => {
                        const st = sessionDisplayStatus(s);
                        if (st === "completed") return <span style={{ color: adminColors.muted }}>completed</span>;
                        return (
                          <span
                            className={styles.badge}
                            style={{ background: st === "in_progress" ? "#60a5fa" : "#f59e0b", color: "#000" }}
                          >
                            {st === "in_progress" ? "in progress" : "not finished"}
                          </span>
                        );
                      })()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className={styles.pagination}>
            <span className={styles.pageInfo}>
              Page {page} of {totalPages}
            </span>
            <div className={styles.pageLinks}>
              <PageLink page={page - 1} status={status} disabled={page <= 1}>&larr; Prev</PageLink>
              <PageLink page={page + 1} status={status} disabled={page >= totalPages}>Next &rarr;</PageLink>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
