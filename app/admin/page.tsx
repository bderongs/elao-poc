import Link from "next/link";
import { listSessions } from "@/lib/sessions-service";
import { wordColor } from "@/components/ScoreDisplay";
import { logout } from "./login/actions";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

function PageLink({ page, disabled, children }: { page: number; disabled: boolean; children: React.ReactNode }) {
  if (disabled) {
    return <span style={{ color: "#374151", fontSize: 12 }}>{children}</span>;
  }
  return (
    <Link href={`/admin?page=${page}`} style={{ color: "#93c5fd", fontSize: 12, textDecoration: "none" }}>
      {children}
    </Link>
  );
}

export default async function AdminSessionsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);

  let sessions: Awaited<ReturnType<typeof listSessions>>["sessions"] = [];
  let total = 0;
  let loadError: string | null = null;
  try {
    const result = await listSessions({ page, pageSize: PAGE_SIZE });
    sessions = result.sessions;
    total = result.total;
  } catch (e) {
    loadError = String(e);
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div style={{ minHeight: "100vh", background: "#0f172a", color: "#e5e7eb", fontFamily: "system-ui, sans-serif", padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Sessions ({total})</h1>
        <form action={logout}>
          <button
            type="submit"
            style={{ background: "none", border: "1px solid #334155", color: "#9ca3af", borderRadius: 4, padding: "4px 10px", fontSize: 12, cursor: "pointer" }}
          >
            Sign out
          </button>
        </form>
      </div>

      {loadError && <div style={{ color: "#f87171" }}>Failed to load sessions: {loadError}</div>}

      {!loadError && sessions.length === 0 && (
        <div style={{ color: "#9ca3af", fontSize: 13 }}>No sessions yet.</div>
      )}

      {sessions.length > 0 && (
        <>
          <div style={{ overflowX: "auto", border: "1px solid #1e293b", borderRadius: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "#9ca3af", background: "#111827" }}>
                  <th style={{ padding: "8px 12px", fontWeight: 600 }}>Date</th>
                  <th style={{ padding: "8px 12px", fontWeight: 600 }}>Language</th>
                  <th style={{ padding: "8px 12px", fontWeight: 600 }}>Level</th>
                  <th style={{ padding: "8px 12px", fontWeight: 600 }}>Score</th>
                  <th style={{ padding: "8px 12px", fontWeight: 600 }}>Duration</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id} style={{ borderTop: "1px solid #1e293b" }}>
                    <td style={{ padding: "8px 12px" }}>
                      <Link href={`/admin/${s.id}`} style={{ color: "#93c5fd", textDecoration: "none" }}>
                        {new Date(s.created_at).toLocaleString()}
                      </Link>
                    </td>
                    <td style={{ padding: "8px 12px" }}>{s.language ?? "—"}</td>
                    <td style={{ padding: "8px 12px" }}>
                      {s.cefr_level ? (
                        <span
                          style={{
                            background: wordColor(s.global_score ?? 0),
                            color: "#000",
                            borderRadius: 4,
                            padding: "1px 8px",
                            fontSize: 12,
                            fontWeight: 700,
                          }}
                        >
                          {s.cefr_level}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td style={{ padding: "8px 12px" }}>{s.global_score ?? "—"}</td>
                    <td style={{ padding: "8px 12px" }}>
                      {s.duration_seconds ? `${Math.round(s.duration_seconds / 60)} min` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16 }}>
            <span style={{ fontSize: 12, color: "#6b7280" }}>
              Page {page} of {totalPages}
            </span>
            <div style={{ display: "flex", gap: 16 }}>
              <PageLink page={page - 1} disabled={page <= 1}>&larr; Prev</PageLink>
              <PageLink page={page + 1} disabled={page >= totalPages}>Next &rarr;</PageLink>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
