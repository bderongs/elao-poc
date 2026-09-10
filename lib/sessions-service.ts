import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServer } from "@/lib/supabase-server";
import { computePronunciationAvg, liveConversationPronunciationProviderId } from "@/lib/pronunciation-rollup";
import { getSystemConfig } from "@/lib/system-config";
import type { SessionSummary, SessionDetailRow, TurnRow, EvaluationRow, TurnEvaluationRow, CefrResult } from "@/lib/types";
import type { PronunciationResult } from "@/lib/pronunciation/types";

// Single source of truth for reading/writing sessions — used by both the
// /api/sessions* route handlers and the admin pages (which call these
// directly rather than round-tripping through their own API), so the
// query/upload logic exists exactly once.

// Includes evaluation_json/pronunciation_scores/speechace_scores even for the
// list view (not just detail) so the session table can show a full score
// breakdown on hover/click, not just the single global_score column.
const SESSION_SUMMARY_COLUMNS =
  "id, created_at, language, cefr_level, global_score, duration_seconds, source, evaluation_json, pronunciation_scores, speechace_scores, user_id";
const SESSION_DETAIL_COLUMNS = `${SESSION_SUMMARY_COLUMNS}, audio_url, source_url, providers_json`;

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
  userId,
}: { page?: number; pageSize?: number; userId?: string } = {}): Promise<ListSessionsResult> {
  const safePage = Math.max(1, page);
  const safePageSize = Math.min(100, Math.max(1, pageSize));
  const from = (safePage - 1) * safePageSize;
  const to = from + safePageSize - 1;

  const supabase = getSupabaseServer();
  let query = supabase
    .from("sessions")
    .select(SESSION_SUMMARY_COLUMNS, { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);
  if (userId) query = query.eq("user_id", userId);
  const { data, error, count } = await query;

  if (error) throw new Error(error.message);
  const sessions = (data ?? []) as SessionSummary[];
  await attachLatestEvalFallback(supabase, sessions);

  return { sessions, total: count ?? 0, page: safePage, pageSize: safePageSize };
}

/**
 * `evaluation_json` is only ever written by the live conversation flow
 * (see SESSION_SUMMARY_COLUMNS above) — upload/Speechace-import sessions
 * never get one, even after being scored via the eval lab, because that
 * result lives in `session_evaluations` instead. The detail page already
 * falls back to "latest successful eval-lab run" for exactly this reason
 * (app/admin/(dashboard)/[id]/page.tsx); without this, the list would show
 * no "our score" for sessions where the detail page shows one. Only queries
 * for sessions actually missing evaluation_json, and only the 3 columns
 * needed to resolve it.
 */
async function attachLatestEvalFallback(supabase: SupabaseClient, sessions: SessionSummary[]): Promise<void> {
  const ids = sessions.filter((s) => !s.evaluation_json).map((s) => s.id);
  if (!ids.length) return;

  const { data, error } = await supabase
    .from("session_evaluations")
    .select("session_id, error, result_json")
    .in("session_id", ids)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  // Query is newest-first, so the first non-error row seen per session_id is
  // that session's latest successful eval-lab run.
  const latestBySession = new Map<string, CefrResult>();
  for (const row of data ?? []) {
    const sessionId = row.session_id as string;
    if (latestBySession.has(sessionId) || row.error || !row.result_json) continue;
    latestBySession.set(sessionId, row.result_json as CefrResult);
  }

  for (const s of sessions) {
    if (!s.evaluation_json) s.latest_eval_json = latestBySession.get(s.id) ?? null;
  }
}

export interface SessionWithTurns {
  session: SessionDetailRow;
  turns: TurnRow[];
  evaluations: EvaluationRow[];
  /** Pronunciation-lab replay results, grouped by turn_id (multiple providers per turn). */
  turnEvaluations: TurnEvaluationRow[];
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

  const turnIds = (turns ?? []).map((t) => t.id);
  let turnEvaluations: TurnEvaluationRow[] = [];
  if (turnIds.length) {
    const { data: turnEvals, error: turnEvalError } = await supabase
      .from("session_turn_evaluations")
      .select("id, turn_id, provider_id, result_json, error, duration_ms, created_at")
      .in("turn_id", turnIds)
      .order("created_at", { ascending: false });
    if (turnEvalError) throw new Error(turnEvalError.message);
    turnEvaluations = (turnEvals ?? []) as TurnEvaluationRow[];
  }

  return {
    session: session as SessionDetailRow,
    turns: (turns ?? []) as TurnRow[],
    evaluations: (evaluations ?? []) as EvaluationRow[],
    turnEvaluations,
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
  const pronunciationScores = parseJsonField(form, "pronunciationScores", null);
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
      pronunciation_scores: pronunciationScores,
      // Snapshot of which provider/model each capability used — read fresh
      // here rather than accepted from the client, since it must reflect
      // what the server actually ran. Accurate because config is static per
      // running server process (no per-session override exists today) — see
      // lib/system-config.ts.
      providers_json: getSystemConfig(),
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

/**
 * Ties an anonymous session to a newly signed-up account (the post-test
 * "save my results" flow) — the `user_id is null` guard makes a repeat call
 * (e.g. a double-clicked magic link) a no-op instead of reassigning an
 * already-claimed session.
 */
export async function claimSession(sessionId: string, userId: string): Promise<void> {
  const supabase = getSupabaseServer();
  const { error } = await supabase
    .from("sessions")
    .update({ user_id: userId })
    .eq("id", sessionId)
    .is("user_id", null);
  if (error) console.error("[sessions] claim failed:", error.message);
}

// ─── recordings as first-class objects (pronunciation lab) ───────────────────

interface UploadedTurn {
  id: string;
  turn_index: number;
  audio_url: string | null;
}

/** Shared by session-upload and append-turn: upload one recording to Storage, insert its `session_turns` row. */
async function uploadTurnAudio(
  supabase: SupabaseClient,
  sessionId: string,
  language: string,
  turnIndex: number,
  audio: Blob,
): Promise<UploadedTurn> {
  const datePrefix = new Date().toISOString().slice(0, 10);
  const ext = audio.type.includes("wav") ? "wav" : audio.type.includes("ogg") ? "ogg" : audio.type.includes("mp4") ? "m4a" : "webm";
  const path = `${language}/${datePrefix}/${sessionId}/turn-${turnIndex}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from("recordings")
    .upload(path, audio, { contentType: audio.type || "audio/webm" });
  if (uploadError) throw new Error(`audio upload failed: ${uploadError.message}`);
  const audioUrl = supabase.storage.from("recordings").getPublicUrl(path).data.publicUrl;

  const { data: turnRow, error: turnError } = await supabase
    .from("session_turns")
    .insert({
      session_id: sessionId,
      turn_index: turnIndex,
      role: "user",
      content: "",
      audio_url: audioUrl,
      pronunciation_json: null,
    })
    .select("id, turn_index, audio_url")
    .single();
  if (turnError || !turnRow) throw new Error(turnError?.message ?? "turn insert failed");

  return turnRow as UploadedTurn;
}

/**
 * Creates a new session from a single uploaded audio file — the "run
 * assessment on any recording" path. Marked `source: 'upload'` so the admin
 * list can tell it apart from a real conversation. Reuses the same
 * session_turns shape, so the existing detail page renders it unchanged.
 */
export async function createUploadSession(form: FormData): Promise<{ id: string }> {
  const supabase = getSupabaseServer();
  const audio = form.get("audio") as Blob | null;
  const language = (form.get("language") as string | null) ?? "en";
  if (!audio || audio.size === 0) throw new Error("No audio file provided");

  const { data: sessionRow, error: insertError } = await supabase
    .from("sessions")
    .insert({ language, source: "upload" })
    .select("id")
    .single();
  if (insertError || !sessionRow) throw new Error(insertError?.message ?? "session insert failed");

  const sessionId = sessionRow.id as string;
  await uploadTurnAudio(supabase, sessionId, language, 0, audio);
  return { id: sessionId };
}

interface SpeechaceQuestion {
  question_attempt_id: number;
  order: number;
  answer: string | null;
  dialect: string | null;
}

interface SpeechaceReport {
  default_rubric?: string | null;
  scoring?: {
    fluency?: { score: number | null } | null;
    pronunciation?: { score: number | null } | null;
    overall?: { score: number | null } | null;
  };
  questions?: SpeechaceQuestion[];
  rubrics?: Array<{ default?: boolean; original_name?: string; score_map?: Record<string, string> }>;
}

const SPEECHACE_FETCH_HEADERS = { "User-Agent": "Mozilla/5.0", Accept: "application/json" };
// A hung connection (seen in practice after a heavy day of Speechace traffic)
// would otherwise stall one of the limited concurrent workers in
// createSpeechaceImportSessions indefinitely, since fetch() has no default
// timeout — one stuck request can tank the whole batch's throughput.
const SPEECHACE_FETCH_TIMEOUT_MS = 15_000;

function parseSpeechaceReportId(reportUrl: string): string {
  const match = reportUrl.match(/\/placement\/report\/([a-f0-9]+)\/?/i);
  if (!match) throw new Error("Not a recognizable Speechace report URL");
  return match[1];
}

/**
 * Speechace's raw scores are on a 0-9 band scale. The report itself carries
 * the rubric's `score_map` (0-9 -> 0-100, same table the report page uses
 * whenever it displays a percentage) — prefer that over computing our own so
 * we always match what Speechace shows. Falls back to the linear formula
 * (band / 9 * 100) the score_map turns out to encode, in case a rubric is
 * ever missing one.
 */
function bandToPercent(band: number | null | undefined, scoreMap: Record<string, string> | undefined): number | null {
  if (band == null) return null;
  const mapped = scoreMap?.[band.toFixed(1)];
  if (mapped != null) return parseFloat(mapped);
  return Math.round((band / 9) * 1000) / 10;
}

/** Speechace tags each question with a dialect like "en-us" — use its language prefix as the session language. */
function languageFromDialect(dialect: string | null | undefined): string {
  return dialect?.split("-")[0] || "en";
}

/**
 * A report URL's trailing slash is inconsistent across imports (some rows
 * have it, some don't), and the id is otherwise unique, so match on it via
 * `like` rather than an exact `source_url` comparison.
 *
 * A batch that ran before this dedup logic existed can have left more than
 * one row for the same report id (one real import plus zero-turn junk from
 * a run that got cut off). Picking an arbitrary match risked "skipping" the
 * empty one and leaving a complete import unrepaired-looking, or "repairing"
 * the empty one into a second complete session alongside the original. So:
 * prefer whichever match already has turns (the real one); only fall back to
 * an arbitrary/empty match if none do.
 */
async function findExistingSpeechaceSession(
  supabase: SupabaseClient,
  reportId: string,
): Promise<{ id: string; language: string } | null> {
  const { data: matches, error } = await supabase
    .from("sessions")
    .select("id, language")
    .eq("source", "speechace")
    .like("source_url", `%/placement/report/${reportId}%`);
  if (error) throw new Error(error.message);
  if (!matches?.length) return null;
  if (matches.length === 1) return matches[0];

  for (const match of matches) {
    const { count, error: countError } = await supabase
      .from("session_turns")
      .select("id", { count: "exact", head: true })
      .eq("session_id", match.id);
    if (countError) throw new Error(countError.message);
    if (count && count > 0) return match;
  }
  return matches[0];
}

/**
 * Creates a session from a competitor (Speechace) placement report, so its
 * results can be compared against ours. Marked `source: 'speechace'`.
 * Pulls the session-level fluency/pronunciation scores only — Speechace's
 * per-question breakdown is intentionally not imported — plus each
 * question's audio, so the same recordings can also be run through our own
 * pronunciation providers for a like-for-like comparison.
 *
 * Idempotent by report id: a session that already has its turns imported is
 * skipped, and one whose session row exists but has zero turns (the batch
 * got cut off before reaching the turn insert — see
 * createSpeechaceImportSessions) is repaired in place rather than
 * duplicated. This makes re-submitting the same URL list after a partial
 * failure safe and cheap — already-complete rows are a fast no-op.
 */
export async function createSpeechaceImportSession(
  reportUrl: string,
): Promise<{ id: string; status: "created" | "repaired" | "skipped" }> {
  const supabase = getSupabaseServer();
  const reportId = parseSpeechaceReportId(reportUrl);

  const existing = await findExistingSpeechaceSession(supabase, reportId);
  if (existing) {
    const { count, error: countError } = await supabase
      .from("session_turns")
      .select("id", { count: "exact", head: true })
      .eq("session_id", existing.id);
    if (countError) throw new Error(countError.message);
    if (count && count > 0) return { id: existing.id, status: "skipped" };
  }

  const reportRes = await fetch(`https://speak.speechace.co/placement/api/report/${reportId}/`, {
    headers: SPEECHACE_FETCH_HEADERS,
    signal: AbortSignal.timeout(SPEECHACE_FETCH_TIMEOUT_MS),
  });
  if (!reportRes.ok) throw new Error(`Speechace report fetch failed: HTTP ${reportRes.status}`);
  const report = (await reportRes.json()) as SpeechaceReport;

  const questions = (report.questions ?? []).slice().sort((a, b) => a.order - b.order);
  const language = existing?.language ?? languageFromDialect(questions[0]?.dialect);
  const datePrefix = new Date().toISOString().slice(0, 10);

  let sessionId: string;
  if (existing) {
    sessionId = existing.id;
  } else {
    const rubric = report.rubrics?.find((r) => r.default) ?? report.rubrics?.[0];
    const scoreMap = rubric?.score_map;

    const { data: sessionRow, error: insertError } = await supabase
      .from("sessions")
      .insert({
        language,
        source: "speechace",
        source_url: reportUrl,
        speechace_scores: {
          fluency: bandToPercent(report.scoring?.fluency?.score, scoreMap),
          pronunciation: bandToPercent(report.scoring?.pronunciation?.score, scoreMap),
          overall: bandToPercent(report.scoring?.overall?.score, scoreMap),
        },
      })
      .select("id")
      .single();
    if (insertError || !sessionRow) throw new Error(insertError?.message ?? "session insert failed");
    sessionId = sessionRow.id as string;
  }

  const turnRows: Array<{
    session_id: string;
    turn_index: number;
    role: string;
    content: string;
    audio_url: string | null;
    pronunciation_json: null;
  }> = [];

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    let audioUrl: string | null = null;
    try {
      const audioRes = await fetch(
        `https://speak.speechace.co/placement/api/question/attempt/${q.question_attempt_id}/audio/?token=${reportId}`,
        { headers: SPEECHACE_FETCH_HEADERS, signal: AbortSignal.timeout(SPEECHACE_FETCH_TIMEOUT_MS) },
      );
      if (audioRes.ok) {
        const path = `${language}/${datePrefix}/${sessionId}/turn-${i}.wav`;
        // upsert: a repaired session (see findExistingSpeechaceSession above)
        // can hit a path a prior, interrupted attempt already uploaded.
        const { error: uploadError } = await supabase.storage
          .from("recordings")
          .upload(path, await audioRes.blob(), { contentType: "audio/wav", upsert: true });
        if (uploadError) console.warn(`[speechace-import] turn ${i} audio upload failed:`, uploadError.message);
        else audioUrl = supabase.storage.from("recordings").getPublicUrl(path).data.publicUrl;
      } else {
        console.warn(`[speechace-import] turn ${i} audio fetch failed: HTTP ${audioRes.status}`);
      }
    } catch (e) {
      console.warn(`[speechace-import] turn ${i} audio fetch error:`, e);
    }

    turnRows.push({
      session_id: sessionId,
      turn_index: i,
      role: "user",
      content: q.answer ?? "",
      audio_url: audioUrl,
      pronunciation_json: null,
    });
  }

  if (turnRows.length) {
    const { error: turnsError } = await supabase.from("session_turns").insert(turnRows);
    if (turnsError) console.error("[speechace-import] turn insert failed:", turnsError.message);
  }

  return { id: sessionId, status: existing ? "repaired" : "created" };
}

// A big paste (300+ URLs) run at full Promise.all concurrency previously
// overwhelmed Speechace/Supabase and got cut off mid-batch by the function
// timeout, leaving many sessions created with zero turns. Capping concurrency
// keeps each run well-behaved; the idempotent skip/repair logic in
// createSpeechaceImportSession means re-submitting the same list afterwards
// (whether it finished or got cut off again) always just finishes the job
// instead of duplicating work.
const SPEECHACE_IMPORT_CONCURRENCY = 4;

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Imports a batch of Speechace report URLs, one session per URL. One bad
 * URL doesn't sink the rest — mirrors the per-provider isolation pattern in
 * runCefrEvaluation (lib/cefr-eval.ts).
 */
export async function createSpeechaceImportSessions(
  urls: string[],
): Promise<Array<{ url: string; id?: string; status?: "created" | "repaired" | "skipped"; error?: string }>> {
  return mapWithConcurrency(urls, SPEECHACE_IMPORT_CONCURRENCY, async (url) => {
    try {
      const { id, status } = await createSpeechaceImportSession(url);
      return { url, id, status };
    } catch (e) {
      return { url, error: e instanceof Error ? e.message : String(e) };
    }
  });
}

/** Appends another recording to an existing session — "add a recording if we have one". */
export async function appendTurn(sessionId: string, form: FormData): Promise<UploadedTurn> {
  const supabase = getSupabaseServer();
  const audio = form.get("audio") as Blob | null;
  if (!audio || audio.size === 0) throw new Error("No audio file provided");

  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .select("language")
    .eq("id", sessionId)
    .single();
  if (sessionError || !session) throw new Error("session not found");

  const { count, error: countError } = await supabase
    .from("session_turns")
    .select("id", { count: "exact", head: true })
    .eq("session_id", sessionId);
  if (countError) throw new Error(countError.message);

  return uploadTurnAudio(supabase, sessionId, (session.language as string | null) ?? "en", count ?? 0, audio);
}

/** Turn lookup for the pronunciation-lab replay route — a turn's audio plus its parent session's language/source. */
export async function getTurnForAssessment(
  turnId: string,
): Promise<{ id: string; audioUrl: string | null; content: string; language: string; source: string } | null> {
  const supabase = getSupabaseServer();

  const { data: turn, error: turnError } = await supabase
    .from("session_turns")
    .select("id, content, audio_url, session_id")
    .eq("id", turnId)
    .single();
  if (turnError || !turn) return null;

  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .select("language, source")
    .eq("id", turn.session_id as string)
    .single();
  if (sessionError || !session) return null;

  return {
    id: turn.id as string,
    audioUrl: turn.audio_url as string | null,
    content: (turn.content as string | null) ?? "",
    language: (session.language as string | null) ?? "en",
    source: (session.source as string | null) ?? "conversation",
  };
}

/**
 * Recomputes an uploaded/imported session's per-turn transcript + session-level
 * `pronunciation_scores` from the LATEST pronunciation-lab run of each turn
 * (across all providers) — called after every assess run so "the global
 * score" for such a session always reflects the most recent evidence, per turn.
 *
 * Only touches `source: 'upload'` or `'speechace'` sessions: a real
 * conversation's transcript and pronunciation_scores are the live flow's
 * actual output and must not be silently overwritten by ad-hoc replay runs.
 *
 * If a turn's latest run failed, that turn drops out of the rollup (rather
 * than falling back to an older successful run) until it's reassessed — a
 * future "pick a different run" action will let you override this.
 */
export async function recomputeSessionRollup(sessionId: string): Promise<void> {
  const supabase = getSupabaseServer();

  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .select("source")
    .eq("id", sessionId)
    .single();
  if (sessionError || !session) throw new Error(sessionError?.message ?? "session not found");
  if (session.source !== "upload" && session.source !== "speechace") return;

  const { data: turns, error: turnsError } = await supabase
    .from("session_turns")
    .select("id, content")
    .eq("session_id", sessionId)
    .eq("role", "user");
  if (turnsError) throw new Error(turnsError.message);
  if (!turns?.length) return;

  const turnIds = turns.map((t) => t.id as string);
  const { data: allEvals, error: evalsError } = await supabase
    .from("session_turn_evaluations")
    .select("turn_id, result_json, created_at")
    .in("turn_id", turnIds)
    .order("created_at", { ascending: false });
  if (evalsError) throw new Error(evalsError.message);

  // Query is newest-first, so the first row seen per turn_id is that turn's
  // latest run, regardless of which provider produced it.
  const latestByTurn = new Map<string, PronunciationResult | null>();
  for (const row of allEvals ?? []) {
    const turnId = row.turn_id as string;
    if (!latestByTurn.has(turnId)) latestByTurn.set(turnId, row.result_json as PronunciationResult | null);
  }

  const results: PronunciationResult[] = [];
  const contentUpdates: Array<{ id: string; content: string }> = [];

  for (const turn of turns) {
    const latest = latestByTurn.get(turn.id as string);
    if (!latest) continue; // no run yet, or the latest run failed
    results.push(latest);
    if (latest.text !== turn.content) contentUpdates.push({ id: turn.id as string, content: latest.text });
  }

  await Promise.all(
    contentUpdates.map(({ id, content }) => supabase.from("session_turns").update({ content }).eq("id", id)),
  );

  const { error: updateError } = await supabase
    .from("sessions")
    .update({ pronunciation_scores: computePronunciationAvg(results) })
    .eq("id", sessionId);
  if (updateError) throw new Error(updateError.message);
}

/**
 * Overwrites a live-conversation session's headline `pronunciation_scores`
 * with its latest re-run from that session's live pronunciation provider
 * (liveConversationPronunciationProviderId — Voxtral for en/fr,
 * azure-ensemble for the rest) — the one deliberate way to let a fresh
 * replay (e.g. after a prompt/calibration tweak to that provider) become the
 * number shown on the session, bypassing the protection in
 * recomputeSessionRollup. Unlike that function, this never touches
 * session_turns.content — the live transcript stays exactly what the
 * assistant actually replied to; only the score changes.
 *
 * Requires every recorded (audio) turn to already have a successful run from
 * that provider — run it from the "run full evaluation" gear first.
 *
 * M8 Track M (2026-08-10): switching the live default from azure-ensemble to
 * voxtral deliberately does NOT bulk-migrate existing sessions' stored
 * pronunciation_scores — decided with the client to leave historical
 * headline scores as-is (as actually produced by the live flow at the time)
 * and only apply voxtral going forward. This function remains the
 * per-session, manually confirmed escape hatch for anyone who wants to
 * re-promote an individual old session to the new default.
 */
export async function promoteConversationRollup(sessionId: string): Promise<void> {
  const supabase = getSupabaseServer();

  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .select("source, language")
    .eq("id", sessionId)
    .single();
  if (sessionError || !session) throw new Error(sessionError?.message ?? "session not found");
  if (session.source !== "conversation") throw new Error("promote-rollup is only for conversation sessions");
  const liveProviderId = liveConversationPronunciationProviderId(session.language as string | null);

  const { data: turns, error: turnsError } = await supabase
    .from("session_turns")
    .select("id")
    .eq("session_id", sessionId)
    .not("audio_url", "is", null);
  if (turnsError) throw new Error(turnsError.message);
  const turnIds = (turns ?? []).map((t) => t.id as string);
  if (!turnIds.length) throw new Error("no recorded turns to promote");

  const { data: evals, error: evalsError } = await supabase
    .from("session_turn_evaluations")
    .select("turn_id, result_json, error, created_at")
    .in("turn_id", turnIds)
    .eq("provider_id", liveProviderId)
    .order("created_at", { ascending: false });
  if (evalsError) throw new Error(evalsError.message);

  // Newest-first, so the first row seen per turn_id is that turn's latest run.
  const latestByTurn = new Map<string, { result_json: PronunciationResult | null; error: string | null }>();
  for (const row of evals ?? []) {
    const turnId = row.turn_id as string;
    if (!latestByTurn.has(turnId)) {
      latestByTurn.set(turnId, {
        result_json: row.result_json as PronunciationResult | null,
        error: row.error as string | null,
      });
    }
  }

  const results: PronunciationResult[] = [];
  for (const turnId of turnIds) {
    const latest = latestByTurn.get(turnId);
    if (!latest || latest.error || !latest.result_json) {
      throw new Error(
        `every recorded turn needs a successful ${liveProviderId} pronunciation-lab run before promoting — run it from the gear first`,
      );
    }
    results.push(latest.result_json);
  }

  const { error: updateError } = await supabase
    .from("sessions")
    .update({ pronunciation_scores: computePronunciationAvg(results) })
    .eq("id", sessionId)
    .eq("source", "conversation");
  if (updateError) throw new Error(updateError.message);
}
