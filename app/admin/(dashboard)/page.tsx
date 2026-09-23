import Link from "next/link";
import { listSessions } from "@/lib/sessions-service";
import { SessionScoreCell } from "@/components/SessionScoreCell";
import { SessionListFilters } from "@/components/SessionListFilters";
import { formatDateTime } from "@/lib/format-date";
import { sessionDisplayStatus } from "@/lib/session-status";
import { adminColors } from "@/lib/admin-theme";
import styles from "@/components/admin.module.css";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

const FILTER_KEYS = ["status", "source", "lang", "from", "to", "minMin", "maxMin"] as const;
type FilterParams = Partial<Record<(typeof FILTER_KEYS)[number], string>>;

const hrefFor = (page: number, filters: FilterParams) => {
  const q = new URLSearchParams();
  if (page > 1) q.set("page", String(page));
  for (const k of FILTER_KEYS) if (filters[k]) q.set(k, filters[k]!);
  const qs = q.toString();
  return qs ? `/admin?${qs}` : "/admin";
};

const isDate = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
const toMinutes = (v?: string) => {
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

function PageLink({ page, filters, disabled, children }: { page: number; filters: FilterParams; disabled: boolean; children: React.ReactNode }) {
  if (disabled) {
    return <span className={styles.pageLinkDisabled}>{children}</span>;
  }
  return (
    <Link href={hrefFor(page, filters)} className={styles.pageLink}>
      {children}
    </Link>
  );
}

export default async function AdminSessionsPage({
  searchParams,
}: {
  searchParams: Promise<FilterParams & { page?: string }>;
}) {
  const { page: pageParam, ...rawFilters } = await searchParams;
  const filters: FilterParams = Object.fromEntries(
    FILTER_KEYS.filter((k) => typeof rawFilters[k] === "string" && rawFilters[k]).map((k) => [k, rawFilters[k]])
  );
  const hasFilters = Object.keys(filters).length > 0;
  const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);

  let sessions: Awaited<ReturnType<typeof listSessions>>["sessions"] = [];
  let total = 0;
  let loadError: string | null = null;
  try {
    const result = await listSessions({
      page,
      pageSize: PAGE_SIZE,
      status: filters.status === "completed" || filters.status === "unfinished" ? filters.status : undefined,
      source: filters.source,
      language: filters.lang,
      dateFrom: isDate(filters.from),
      dateTo: isDate(filters.to),
      minMinutes: toMinutes(filters.minMin),
      maxMinutes: toMinutes(filters.maxMin),
    });
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

      {hasFilters && (
        <div style={{ margin: "0 0 12px", fontSize: 14 }}>
          <Link href="/admin" className={styles.rowLink}>
            ✕ Clear filters
          </Link>
        </div>
      )}

      {loadError && <div className={styles.errorBox}>Failed to load sessions: {loadError}</div>}

      {!loadError && (
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
                <SessionListFilters />
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
            {sessions.length === 0 && (
              <div className={styles.emptyState}>{hasFilters ? "No sessions match these filters." : "No sessions yet."}</div>
            )}
          </div>

          <div className={styles.pagination}>
            <span className={styles.pageInfo}>
              Page {page} of {totalPages}
            </span>
            <div className={styles.pageLinks}>
              <PageLink page={page - 1} filters={filters} disabled={page <= 1}>&larr; Prev</PageLink>
              <PageLink page={page + 1} filters={filters} disabled={page >= totalPages}>Next &rarr;</PageLink>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
