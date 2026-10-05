import { getSupabaseServer } from "@/lib/supabase-server";

export interface SessionFeedback {
  experience_rating: number;
  questions_relevance: number;
  grade_relevance: number;
  comment: string | null;
  created_at: string;
}

export type SessionFeedbackInput = Omit<SessionFeedback, "created_at"> & { sessionId: string };

/** Upsert on session_id — a resubmit overwrites the previous answer. */
export async function saveSessionFeedback(input: SessionFeedbackInput): Promise<void> {
  const { error } = await getSupabaseServer()
    .from("session_feedback")
    .upsert(
      {
        session_id: input.sessionId,
        experience_rating: input.experience_rating,
        questions_relevance: input.questions_relevance,
        grade_relevance: input.grade_relevance,
        comment: input.comment,
      },
      { onConflict: "session_id" },
    );
  if (error) throw new Error(error.message);
}

export async function getSessionFeedback(sessionId: string): Promise<SessionFeedback | null> {
  const { data, error } = await getSupabaseServer()
    .from("session_feedback")
    .select("experience_rating, questions_relevance, grade_relevance, comment, created_at")
    .eq("session_id", sessionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}
