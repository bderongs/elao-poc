/**
 * Turns the existing turnLogId scheme ("start" / "turn-N" / "end") into the
 * A/ET/EO/STT process labels used throughout logs/server-*.log — see the
 * 2026-08-12 session log entry on splitting the answer call (A) from
 * assessment (ET = Evaluation Transcription, EO = Evaluation Oral), and
 * doc/assessment_process.md for STT's later move to a blocking Voxtral call.
 *
 * A{n} = the n-th examiner reply. A1 is the opening greeting+warm-up
 * ("start"); A{N+1} is the reply generated for wire turnLogId "turn-N".
 * ET{n}/EO{n} = the text/audio assessment of the user's answer to A{n} —
 * i.e. produced during wire turnLogId "turn-n" and used (best-effort,
 * non-blocking) to steer A{n+1}.
 *
 * Pure string helpers only — safe to import from both client and server code.
 */

export function chatProcessLabel(turnLogId: string): string {
  if (turnLogId === "start") return "A1";
  if (turnLogId === "end") return "A_end";
  const m = turnLogId.match(/^turn-(\d+)$/);
  return m ? `A${Number(m[1]) + 1}` : "A?";
}

export function assessProcessLabel(kind: "ET" | "EO" | "STT" | "TT", turnLogId: string): string {
  // TT classifies the examiner's OWN question (A{n}), so — unlike ET/EO/STT,
  // which always grade a real user answer keyed "turn-N" — it can also fire
  // for the opening/closing turns, wired the same turnLogId as chatProcessLabel.
  if (kind === "TT") {
    if (turnLogId === "start") return "TT1";
    if (turnLogId === "end") return "TT_end";
  }
  const m = turnLogId.match(/^turn-(\d+)$/);
  return m ? `${kind}${m[1]}` : `${kind}?`;
}
