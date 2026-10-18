/**
 * Proof that a live session's CEFR evaluation came from /api/evaluate.
 *
 * The browser runs the evaluation (app/api/evaluate) and then hands the
 * result to the public final save (POST /api/sessions) — without a check, a
 * candidate could post any level they liked. /api/evaluate now signs exactly
 * what it produced, together with the pronunciation figures and the answers
 * it scored, and the save keeps an evaluation only if that signature matches
 * what it receives (lib/sessions-service.ts createSessionFromForm).
 *
 * What this does NOT cover: the answers themselves are transcribed in the
 * browser (realtime STT goes straight to Mistral), so a determined candidate
 * could still have a made-up transcript evaluated. The signature binds the
 * stored score to the stored transcript, which an admin can read back.
 *
 * Server-only (node:crypto).
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const EVALUATION_SIGNATURE_HEADER = "X-Evaluation-Signature";

function signingKey(): Buffer {
  // A dedicated secret if one is set; otherwise derived from the service-role
  // key, which every environment already has — no new variable to configure.
  const secret = process.env.EVALUATION_SIGNING_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("EVALUATION_SIGNING_SECRET (or SUPABASE_SERVICE_ROLE_KEY) not set");
  return createHash("sha256").update(`elao-evaluation-v1:${secret}`).digest();
}

/**
 * Both sides serialise with JSON.stringify: the evaluation the browser sends
 * back is the one it parsed from /api/evaluate's response, and a
 * parse/stringify round trip of the same object yields the same string.
 */
function digest(params: { language: string; evaluation: unknown; pronunciation: unknown; userTurns: string[] }): string {
  return createHmac("sha256", signingKey())
    .update(
      JSON.stringify([
        params.language,
        JSON.stringify(params.evaluation),
        JSON.stringify(params.pronunciation ?? null),
        params.userTurns.map((t) => t.trim()),
      ]),
    )
    .digest("hex");
}

export function signEvaluation(params: { language: string; evaluation: unknown; pronunciation: unknown; userTurns: string[] }): string {
  return digest(params);
}

export function verifyEvaluation(
  signature: string | null | undefined,
  params: { language: string; evaluation: unknown; pronunciation: unknown; userTurns: string[] },
): boolean {
  if (!signature || !/^[0-9a-f]{64}$/.test(signature)) return false;
  return timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(digest(params), "hex"));
}
