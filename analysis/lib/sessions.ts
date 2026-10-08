import { getSupabaseServer } from "../../lib/supabase-server";
import type { CefrResult, PronunciationAvg } from "../../lib/types";
import type { SessionFacts } from "./rules";

export interface LoadOptions {
  since?: string;
  lang?: string;
  /** sessions.source: "conversation" (real live sessions, default), "simulation", "upload", or "all". */
  source: string;
  limit: number;
}

const chunk = <T>(a: T[], n: number): T[][] => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

/** Completed sessions that hold a stored CEFR evaluation, newest first, with the answer counts the C2-floor rule needs. */
export async function loadSessionFacts(o: LoadOptions): Promise<SessionFacts[]> {
  const sb = getSupabaseServer();
  let q = sb
    .from("sessions")
    .select("id, language, created_at, cefr_level, evaluation_json, pronunciation_scores")
    .not("evaluation_json", "is", null)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(o.limit);
  if (o.source !== "all") q = q.eq("source", o.source);
  if (o.since) q = q.gte("created_at", o.since);
  if (o.lang) q = q.eq("language", o.lang);
  const { data, error } = await q;
  if (error) throw new Error(`sessions query failed: ${error.message}`);
  const rows = data ?? [];

  const words = new Map<string, number[]>();
  for (const ids of chunk(rows.map((r) => r.id as string), 50)) {
    const { data: turns, error: e2 } = await sb.from("session_turns").select("session_id, content").in("session_id", ids).eq("role", "user");
    if (e2) throw new Error(`session_turns query failed: ${e2.message}`);
    for (const t of turns ?? []) {
      const n = String(t.content ?? "").trim().split(/\s+/).filter(Boolean).length;
      words.set(t.session_id, [...(words.get(t.session_id) ?? []), n]);
    }
  }

  return rows.map((r) => {
    const w = words.get(r.id as string) ?? [];
    const ev = r.evaluation_json as CefrResult;
    return {
      id: r.id as string,
      language: r.language as string | null,
      createdAt: r.created_at as string,
      storedLevel: r.cefr_level as string | null,
      evaluation: r.evaluation_json as CefrResult,
      pronunciation: (r.pronunciation_scores as PronunciationAvg | null) ?? null,
      storedEvidence:
        typeof ev.answer_count === "number" && typeof ev.words_per_answer === "number"
          ? { answers: ev.answer_count, wordsPerAnswer: ev.words_per_answer }
          : null,
      turnEvidence: { answers: w.length, wordsPerAnswer: w.length ? w.reduce((a, b) => a + b, 0) / w.length : 0 },
    };
  });
}
