import Link from "next/link";
import { notFound } from "next/navigation";
import { getSessionDetail } from "@/lib/sessions-service";
import { CefrPanel, UserWords, UtteranceBadges, wordColor } from "@/components/ScoreDisplay";
import { EvalLabPanel } from "@/components/EvalLabPanel";
import { listProviders } from "@/lib/llm/registry";

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
    <div style={{ minHeight: "100vh", background: "#0f172a", color: "#e5e7eb", fontFamily: "system-ui, sans-serif", padding: 24 }}>
      <Link href="/admin" style={{ color: "#93c5fd", fontSize: 13, textDecoration: "none" }}>
        &larr; All sessions
      </Link>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 24, marginTop: 16 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <h1 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>
              {session.language ?? "—"} · {new Date(session.created_at).toLocaleString()}
            </h1>
            {session.cefr_level && (
              <span
                style={{
                  background: wordColor(session.global_score ?? 0),
                  color: "#000",
                  borderRadius: 4,
                  padding: "1px 8px",
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                {session.cefr_level}
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 16 }}>
            Duration: {session.duration_seconds ? `${Math.round(session.duration_seconds / 60)} min` : "—"}
          </div>

          {session.audio_url && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 4 }}>Full session recording</div>
              <audio controls src={session.audio_url} style={{ width: "100%" }} />
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {turns.map((t) => (
              <div
                key={t.id}
                style={{
                  padding: 10,
                  borderRadius: 6,
                  background: t.role === "user" ? "#1e293b" : "#111827",
                  border: "1px solid #1e293b",
                }}
              >
                <div style={{ fontSize: 10, color: "#6b7280", marginBottom: 4, textTransform: "uppercase" }}>
                  {t.role} · turn {t.turn_index + 1}
                </div>
                <div style={{ fontSize: 14, lineHeight: 1.5 }}>
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
            <div style={{ fontSize: 12, color: "#9ca3af" }}>No evaluation recorded for this session.</div>
          )}
        </div>
      </div>

      <EvalLabPanel sessionId={session.id} providers={providerOptions} initialEvaluations={evaluations} />
    </div>
  );
}
