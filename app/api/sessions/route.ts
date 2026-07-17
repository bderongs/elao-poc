import { getSupabaseServer } from "@/lib/supabase-server";

export const runtime = "nodejs";

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
 * POST /api/sessions
 * Server-side session save. Replaces the previous browser -> Supabase (anon
 * key) direct insert. Uploads the session recording + per-turn recordings to
 * Storage and writes `sessions` + `session_turns` with the service role, so
 * the anon key is never exposed and the browser bundle never touches
 * Supabase directly.
 */
export async function POST(req: Request) {
  const supabase = getSupabaseServer();
  const form = await req.formData();

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
    console.error("[sessions] insert failed:", insertError?.message);
    return Response.json({ error: insertError?.message ?? "insert failed" }, { status: 500 });
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

  return Response.json({ id: sessionId });
}
