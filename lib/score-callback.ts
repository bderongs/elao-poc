/**
 * Score callback (Track AG): when a session is completed with a score, POST
 * the result to an external URL (the client's system). Configured here in
 * code, NOT editable from the admin — /admin/system-config only displays it,
 * same as the provider registries.
 *
 * Sent server-side after the final save (app/api/sessions/route.ts, via
 * next/server's after()), never from the browser, so a closed tab can't lose
 * it. Body is signed with HMAC-SHA256 when SCORE_CALLBACK_SECRET is set.
 *
 * Server-only (node:crypto).
 */

import { createHmac } from "node:crypto";
import { computeCompositeCefrScore } from "@/lib/cefr-score";
import { logServerEvent } from "@/lib/server-log";
import type { CefrResult, PronunciationAvg } from "@/lib/types";

export const SCORE_CALLBACK = {
  /** Off until the client confirms the receiving side (AG-01) — flip to true to send. */
  enabled: false,
  /** Default placeholder endpoint; SCORE_CALLBACK_URL overrides it per environment. */
  url: process.env.SCORE_CALLBACK_URL || "https://www.elao-test.com/callback",
  /** Only event sent today — eval-lab re-runs don't trigger a callback. */
  events: ["session.completed"] as const,
  timeoutMs: 5000,
  maxAttempts: 3,
  /** Header carrying "sha256=<hex HMAC of the raw body>", only when a secret is set. */
  signatureHeader: "X-Elao-Signature",
};

/** What /admin/system-config shows — never the secret itself. */
export function getScoreCallbackConfig() {
  return {
    enabled: SCORE_CALLBACK.enabled,
    url: SCORE_CALLBACK.url,
    urlFromEnv: Boolean(process.env.SCORE_CALLBACK_URL),
    events: [...SCORE_CALLBACK.events],
    timeoutMs: SCORE_CALLBACK.timeoutMs,
    maxAttempts: SCORE_CALLBACK.maxAttempts,
    signed: Boolean(process.env.SCORE_CALLBACK_SECRET),
    signatureHeader: SCORE_CALLBACK.signatureHeader,
  };
}

export type ScoreCallbackConfig = ReturnType<typeof getScoreCallbackConfig>;

export interface ScoreCallbackSession {
  id: string;
  language: string;
  user_id: string | null;
  duration_seconds: number;
  evaluation_json: CefrResult | null;
  pronunciation_scores: PronunciationAvg | null;
}

export function buildScoreCallbackPayload(session: ScoreCallbackSession, reportUrl: string) {
  const evaluation = session.evaluation_json;
  const composite = evaluation ? computeCompositeCefrScore(evaluation, session.pronunciation_scores) : null;
  return {
    event: "session.completed" as const,
    session_id: session.id,
    user_id: session.user_id,
    language: session.language,
    duration_seconds: session.duration_seconds,
    completed_at: new Date().toISOString(),
    level: composite?.level ?? null,
    score: composite?.score ?? null,
    confidence: evaluation?.confidence ?? null,
    axes: {
      pronunciation: session.pronunciation_scores ? Math.round(session.pronunciation_scores.pronunciation) : null,
      // 0-100 like pronunciation (LLM axes are half points on 0-10, so steps of 5 here)
      fluency: evaluation?.dimensions.fluency != null ? evaluation.dimensions.fluency * 10 : null,
      vocabulary_grammar: evaluation?.dimensions.vocabulary_grammar != null ? evaluation.dimensions.vocabulary_grammar * 10 : null,
      communication: evaluation?.dimensions.communication != null ? evaluation.dimensions.communication * 10 : null,
    },
    report_url: reportUrl,
  };
}

/**
 * Sends the callback for a completed session — retries with backoff, logs
 * every attempt. Never throws: a failing receiver must not affect the save.
 */
export async function sendScoreCallback(session: ScoreCallbackSession, reportUrl: string): Promise<void> {
  if (!SCORE_CALLBACK.enabled) {
    logServerEvent("score_callback_skipped", { sessionId: session.id, reason: "disabled" });
    return;
  }
  if (!session.evaluation_json) {
    logServerEvent("score_callback_skipped", { sessionId: session.id, reason: "no_evaluation" });
    return;
  }
  const body = JSON.stringify(buildScoreCallbackPayload(session, reportUrl));
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const secret = process.env.SCORE_CALLBACK_SECRET;
  if (secret) headers[SCORE_CALLBACK.signatureHeader] = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

  for (let attempt = 1; attempt <= SCORE_CALLBACK.maxAttempts; attempt++) {
    try {
      const res = await fetch(SCORE_CALLBACK.url, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(SCORE_CALLBACK.timeoutMs),
      });
      logServerEvent(res.ok ? "score_callback_sent" : "score_callback_failed", { sessionId: session.id, attempt, status: res.status });
      // 4xx won't get better by retrying (bad URL, rejected payload).
      if (res.ok || (res.status >= 400 && res.status < 500)) return;
    } catch (e) {
      logServerEvent("score_callback_failed", { sessionId: session.id, attempt, error: String(e) });
    }
    if (attempt < SCORE_CALLBACK.maxAttempts) await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
  }
}
