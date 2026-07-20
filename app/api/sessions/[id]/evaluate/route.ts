import { getSupabaseServer } from "@/lib/supabase-server";
import { getProvider } from "@/lib/llm/registry";
import { CEFR_SYSTEM_PROMPT, CEFR_PROMPT_VERSION, buildEvaluationUserMessage } from "@/lib/cefr-prompt";
import type { ConvLang } from "@/lib/conversation-prompts";

export const runtime = "nodejs";

interface EvaluateRequest {
  providers: string[];
}

/**
 * POST /api/sessions/:id/evaluate
 * Re-runs a stored session's transcript through one or more LLM providers
 * and persists each result to session_evaluations — the eval lab's replay
 * path, separate from the live in-session /api/evaluate call.
 * Gated by middleware.ts (admin cookie required), since this triggers paid
 * LLM calls and returns transcript data.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = await params;
  const { providers } = (await req.json()) as EvaluateRequest;

  if (!providers?.length) {
    return Response.json({ error: "No providers specified" }, { status: 400 });
  }

  const supabase = getSupabaseServer();

  const [{ data: session, error: sessionError }, { data: turns, error: turnsError }] = await Promise.all([
    supabase.from("sessions").select("language, azure_scores").eq("id", sessionId).single(),
    supabase
      .from("session_turns")
      .select("content, role")
      .eq("session_id", sessionId)
      .eq("role", "user")
      .order("turn_index", { ascending: true }),
  ]);

  if (sessionError || !session) {
    return Response.json({ error: sessionError?.message ?? "session not found" }, { status: 404 });
  }
  if (turnsError) {
    return Response.json({ error: turnsError.message }, { status: 500 });
  }

  const userTurns = (turns ?? []).map((t) => t.content as string);
  if (!userTurns.length) {
    return Response.json({ error: "No user turns stored for this session" }, { status: 400 });
  }

  const userMessage = buildEvaluationUserMessage(
    session.language as ConvLang,
    userTurns,
    (session.azure_scores as { pronunciation: number; wpm: number; count: number; shortTurns?: number } | null) ?? undefined,
  );

  const results = await Promise.all(
    providers.map(async (providerId) => {
      const startedAt = Date.now();
      try {
        const provider = getProvider(providerId);
        const text = await provider.complete({
          model: provider.defaultModel,
          system: CEFR_SYSTEM_PROMPT,
          messages: [{ role: "user", content: userMessage }],
          maxTokens: 1500,
          json: true,
        });
        const cleaned = text.replace(/^```json\s*|\s*```$/g, "").trim();
        const resultJson = JSON.parse(cleaned);
        const durationMs = Date.now() - startedAt;

        const { data: row, error: insertError } = await supabase
          .from("session_evaluations")
          .insert({
            session_id: sessionId,
            model_id: providerId,
            prompt_version: CEFR_PROMPT_VERSION,
            result_json: resultJson,
            duration_ms: durationMs,
          })
          .select("*")
          .single();

        if (insertError) throw new Error(insertError.message);
        return row;
      } catch (e) {
        const durationMs = Date.now() - startedAt;
        const { data: row } = await supabase
          .from("session_evaluations")
          .insert({
            session_id: sessionId,
            model_id: providerId,
            prompt_version: CEFR_PROMPT_VERSION,
            error: String(e),
            duration_ms: durationMs,
          })
          .select("*")
          .single();
        return row ?? { model_id: providerId, prompt_version: CEFR_PROMPT_VERSION, error: String(e) };
      }
    }),
  );

  return Response.json({ results });
}
