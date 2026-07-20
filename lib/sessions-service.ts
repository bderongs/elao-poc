import { getSupabaseServer } from "@/lib/supabase-server";
import type { SessionSummary, SessionDetailRow, TurnRow, EvaluationRow } from "@/lib/types";

// Single source of truth for reading/writing sessions — used by both the
// /api/sessions* route handlers and the admin pages (which call these
// directly rather than round-tripping through their own API), so the
// query/upload logic exists exactly once.

const SESSION_SUMMARY_COLUMNS = "id, created_at, language, cefr_level, global_score, duration_seconds";
const SESSION_DETAIL_COLUMNS = `${SESSION_SUMMARY_COLUMNS}, audio_url, evaluation_json, azure_scores`;

// ─── list / detail (read) ──────────────────────────────────────────────────

export interface ListSessionsResult {
  sessions: SessionSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listSessions({
  page = 1,
  pageSize = 25,
}: { page?: number; pageSize?: number } = {}): Promise<ListSessionsResult> {
  const safePage = Math.max(1, page);
  const safePageSize = Math.min(100, Math.max(1, pageSize));
  const from = (safePage - 1) * safePageSize;
  const to = from + safePageSize - 1;

  const supabase = getSupabaseServer();
  const { data, error, count } = await supabase
    .from("sessions")
    .select(SESSION_SUMMARY_COLUMNS, { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) throw new Error(error.message);
  return { sessions: (data ?? []) as SessionSummary[], total: count ?? 0, page: safePage, pageSize: safePageSize };
}

export interface SessionWithTurns {
  session: SessionDetailRow;
  turns: TurnRow[];
  evaluations: EvaluationRow[];
}

export async function getSessionDetail(id: string): Promise<SessionWithTurns | null> {
  const supabase = getSupabaseServer();

  const [{ data: session, error: sessionError }, { data: turns, error: turnsError }, { data: evaluations, error: evalError }] =
    await Promise.all([
      supabase.from("sessions").select(SESSION_DETAIL_COLUMNS).eq("id", id).single(),
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

  if (sessionError || !session) return null;
  if (turnsError) throw new Error(turnsError.message);
  if (evalError) throw new Error(evalError.message);

  return {
    session: session as SessionDetailRow,
    turns: (turns ?? []) as TurnRow[],
    evaluations: (evaluations ?? []) as EvaluationRow[],
  };
}

// ─── create (write) ─────────────────────────────────────────────────────────

interface TurnMeta {
  role: "user" | "assistant";
  content: string;
  pronunciation: unknown | null;
  hasAudio: boolean;
}

function parseJsonField<T>(form: FormData, key: string, fallback: T): T {
  const raw = form.get(key) as string | null;
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * Persists a completed session: uploads the whole-session recording and each
 * turn's recording to Storage, then writes `sessions` + `session_turns`.
 * Called from POST /api/sessions (the only public, unauthenticated write
 * path — the live conversation UI posts here at the end of a session).
 */
export async function createSessionFromForm(form: FormData): Promise<{ id: string }> {
  const supabase = getSupabaseServer();

  const language = (form.get("language") as string | null) ?? "en";
  const durationSeconds = parseInt((form.get("durationSeconds") as string | null) ?? "0", 10);
  const cefrLevel = (form.get("cefrLevel") as string | null) || null;
  const globalScoreRaw = form.get("globalScore") as string | null;
  const globalScore = globalScoreRaw ? parseInt(globalScoreRaw, 10) : null;
  const scores = parseJsonField(form, "scores", null);
  const evaluation = parseJsonField(form, "evaluation", null);
  const azureScores = parseJsonField(form, "azureScores", null);
  const turns = parseJsonField<TurnMeta[]>(form, "turns", []);

  const datePrefix = new Date().toISOString().slice(0, 10);

  // ── whole-session recording (listen-back) ──
  const sessionAudio = form.get("sessionAudio") as Blob | null;
  let audioUrl: string | null = null;
  if (sessionAudio && sessionAudio.size > 0) {
    const ext = sessionAudio.type.includes("ogg") ? "ogg" : "webm";
    const path = `${language}/${datePrefix}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage
      .from("recordings")
      .upload(path, sessionAudio, { contentType: sessionAudio.type });
    if (error) {
      console.error("[sessions] session audio upload failed:", error.message);
    } else {
      audioUrl = supabase.storage.from("recordings").getPublicUrl(path).data.publicUrl;
    }
  }

  const { data: sessionRow, error: insertError } = await supabase
    .from("sessions")
    .insert({
      language,
      duration_seconds: durationSeconds,
      cefr_level: cefrLevel,
      global_score: globalScore,
      scores,
      evaluation_json: evaluation,
      transcript: turns.map(({ role, content, pronunciation }) => ({ role, content, pronunciation })),
      audio_url: audioUrl,
      azure_scores: azureScores,
    })
    .select("id")
    .single();

  if (insertError || !sessionRow) {
    throw new Error(insertError?.message ?? "session insert failed");
  }

  const sessionId = sessionRow.id as string;

  // ── per-turn recordings (answer-level replay) ──
  const turnRows: Array<{
    session_id: string;
    turn_index: number;
    role: string;
    content: string;
    audio_url: string | null;
    pronunciation_json: unknown | null;
  }> = [];

  for (let i = 0; i < turns.length; i++) {
    const meta = turns[i];
    let turnAudioUrl: string | null = null;
    if (meta.hasAudio) {
      const file = form.get(`turnAudio_${i}`) as Blob | null;
      if (file && file.size > 0) {
        const path = `${language}/${datePrefix}/${sessionId}/turn-${i}.wav`;
        const { error } = await supabase.storage
          .from("recordings")
          .upload(path, file, { contentType: file.type || "audio/wav" });
        if (error) {
          console.warn(`[sessions] turn ${i} audio upload failed:`, error.message);
        } else {
          turnAudioUrl = supabase.storage.from("recordings").getPublicUrl(path).data.publicUrl;
        }
      }
    }
    turnRows.push({
      session_id: sessionId,
      turn_index: i,
      role: meta.role,
      content: meta.content,
      audio_url: turnAudioUrl,
      pronunciation_json: meta.pronunciation,
    });
  }

  if (turnRows.length) {
    const { error: turnsError } = await supabase.from("session_turns").insert(turnRows);
    if (turnsError) console.error("[sessions] turn insert failed:", turnsError.message);
  }

  return { id: sessionId };
}
