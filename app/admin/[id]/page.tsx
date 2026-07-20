import Link from "next/link";
import { notFound } from "next/navigation";
import { getSupabaseServer } from "@/lib/supabase-server";
import type { PronunciationResult } from "@/lib/azure-stt";
import { CefrPanel, UserWords, UtteranceBadges, type AzureAvg, type CefrResult } from "@/components/ScoreDisplay";
import { EvalLabPanel, type EvaluationRow } from "@/components/EvalLabPanel";
import { listProviders } from "@/lib/llm/registry";

export const dynamic = "force-dynamic";

interface SessionDetail {
  id: string;
  created_at: string;
  language: string | null;
  cefr_level: string | null;
  global_score: number | null;
  duration_seconds: number | null;
  audio_url: string | null;
  evaluation_json: CefrResult | null;
  azure_scores: AzureAvg | null;
}

interface TurnRow {
  id: string;
  turn_index: number;
  role: "user" | "assistant";
  content: string;
  audio_url: string | null;
  pronunciation_json: PronunciationResult | null;
}

export default async function AdminSessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = getSupabaseServer();

  const [{ data: session, error: sessionError }, { data: turns, error: turnsError }, { data: evaluations }] =
    await Promise.all([
      supabase
        .from("sessions")
        .select("id, created_at, language, cefr_level, global_score, duration_seconds, audio_url, evaluation_json, azure_scores")
        .eq("id", id)
        .single(),
      supabase
        .from("session_turns")
        .select("id, turn_index, role, content, audio_url, pronunciation_json")
        .eq("session_id", id)
        .order("turn_index", { ascending: true }),
      supabase
        .from("session_evaluations")
        .select("id, model_id, prompt_version, result_json, error, duration_ms, created_at")
        .eq("session_id", id)
        .order("created_at", { ascending: false }),
    ]);

  if (sessionError || !session) notFound();

  const sessionRow = session as SessionDetail;
  const turnRows = (turns ?? []) as TurnRow[];
  const evaluationRows = (evaluations ?? []) as EvaluationRow[];
  const providerOptions = listProviders().map((p) => ({ id: p.id, label: p.label }));

  return (
    <div style={{ minHeight: "100vh", background: "#0f172a", color: "#e5e7eb", fontFamily: "system-ui, sans-serif", padding: 24 }}>
      <Link href="/admin" style={{ color: "#93c5fd", fontSize: 13, textDecoration: "none" }}>
        &larr; All sessions
      </Link>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 24, marginTop: 16 }}>
        <div>
          <h1 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>
            {sessionRow.language ?? "—"} · {new Date(sessionRow.created_at).toLocaleString()}
          </h1>
          <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 16 }}>
            Duration: {sessionRow.duration_seconds ? `${Math.round(sessionRow.duration_seconds / 60)} min` : "—"}
          </div>

          {sessionRow.audio_url && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 4 }}>Full session recording</div>
              <audio controls src={sessionRow.audio_url} style={{ width: "100%" }} />
            </div>
          )}

          {turnsError && <div style={{ color: "#f87171", marginBottom: 12 }}>Failed to load turns: {turnsError.message}</div>}

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {turnRows.map((t) => (
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
          {sessionRow.evaluation_json ? (
            <CefrPanel result={sessionRow.evaluation_json} azureAvg={sessionRow.azure_scores} />
          ) : (
            <div style={{ fontSize: 12, color: "#9ca3af" }}>No evaluation recorded for this session.</div>
          )}
        </div>
      </div>

      <EvalLabPanel sessionId={sessionRow.id} providers={providerOptions} initialEvaluations={evaluationRows} />
    </div>
  );
}
