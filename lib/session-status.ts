/** An in_progress session with no activity for this long is treated as abandoned. */
export const UNFINISHED_AFTER_MS = 10 * 60 * 1000;

export type SessionDisplayStatus = "completed" | "in_progress" | "not_finished";

/** Read-time status: no scheduled job flips abandoned sessions, they just age into "not finished". */
export function sessionDisplayStatus(s: { status: "in_progress" | "completed"; last_activity_at: string }): SessionDisplayStatus {
  if (s.status === "completed") return "completed";
  return Date.now() - new Date(s.last_activity_at).getTime() > UNFINISHED_AFTER_MS ? "not_finished" : "in_progress";
}
