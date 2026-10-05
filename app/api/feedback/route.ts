import { saveSessionFeedback } from "@/lib/feedback-service";
import { getSupabaseServer } from "@/lib/supabase-server";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function rating(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 10 ? v : null;
}

/**
 * Stores the optional post-assessment satisfaction survey
 * (components/SatisfactionModal.tsx). Public (no admin gate) — called from
 * the candidate results screen; only active when NEXT_PUBLIC_SATISFACTION_MODAL=1.
 */
export async function POST(req: Request) {
  if (process.env.NEXT_PUBLIC_SATISFACTION_MODAL !== "1") {
    return new Response(null, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
  const experience = rating(body.experienceRating);
  const questions = rating(body.questionsRelevance);
  const grade = rating(body.gradeRelevance);
  if (!UUID_RE.test(sessionId) || experience == null || questions == null || grade == null) {
    return Response.json({ error: "invalid payload" }, { status: 400 });
  }
  const comment = typeof body.comment === "string" ? body.comment.trim().slice(0, 1000) || null : null;

  try {
    const { data } = await getSupabaseServer().from("sessions").select("id").eq("id", sessionId).maybeSingle();
    if (!data) return Response.json({ error: "unknown session" }, { status: 404 });

    await saveSessionFeedback({
      sessionId,
      experience_rating: experience,
      questions_relevance: questions,
      grade_relevance: grade,
      comment,
    });
    return new Response(null, { status: 204 });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
