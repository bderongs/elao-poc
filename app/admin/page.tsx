import Link from "next/link";
import { getSupabaseServer } from "@/lib/supabase-server";
import { logout } from "./login/actions";

export const dynamic = "force-dynamic";

interface SessionRow {
  id: string;
  created_at: string;
  language: string | null;
  cefr_level: string | null;
  global_score: number | null;
  duration_seconds: number | null;
}

export default async function AdminSessionsPage() {
  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from("sessions")
    .select("id, created_at, language, cefr_level, global_score, duration_seconds")
    .order("created_at", { ascending: false })
    .limit(100);

  const sessions = (data ?? []) as SessionRow[];

  return (
    <div style={{ minHeight: "100vh", background: "#0f172a", color: "#e5e7eb", fontFamily: "system-ui, sans-serif", padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Sessions ({sessions.length})</h1>
        <form action={logout}>
          <button
            type="submit"
            style={{ background: "none", border: "1px solid #334155", color: "#9ca3af", borderRadius: 4, padding: "4px 10px", fontSize: 12, cursor: "pointer" }}
          >
            Sign out
          </button>
        </form>
      </div>

      {error && <div style={{ color: "#f87171" }}>Failed to load sessions: {error.message}</div>}

      {!error && sessions.length === 0 && (
        <div style={{ color: "#9ca3af", fontSize: 13 }}>No sessions yet.</div>
      )}

      {sessions.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "#9ca3af", borderBottom: "1px solid #334155" }}>
              <th style={{ padding: "6px 8px" }}>Date</th>
              <th style={{ padding: "6px 8px" }}>Language</th>
              <th style={{ padding: "6px 8px" }}>Level</th>
              <th style={{ padding: "6px 8px" }}>Score</th>
              <th style={{ padding: "6px 8px" }}>Duration</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id} style={{ borderBottom: "1px solid #1e293b" }}>
                <td style={{ padding: "6px 8px" }}>
                  <Link href={`/admin/${s.id}`} style={{ color: "#93c5fd", textDecoration: "none" }}>
                    {new Date(s.created_at).toLocaleString()}
                  </Link>
                </td>
                <td style={{ padding: "6px 8px" }}>{s.language ?? "—"}</td>
                <td style={{ padding: "6px 8px" }}>{s.cefr_level ?? "—"}</td>
                <td style={{ padding: "6px 8px" }}>{s.global_score ?? "—"}</td>
                <td style={{ padding: "6px 8px" }}>
                  {s.duration_seconds ? `${Math.round(s.duration_seconds / 60)} min` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
