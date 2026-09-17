/**
 * Mints a short-lived (~900s) Mistral realtime session token so the browser
 * can open a WebSocket DIRECTLY to Mistral's streaming transcription endpoint
 * (lib/realtime-stt.ts) without ever seeing MISTRAL_API_KEY — the key is used
 * here, server-side, only to make this one REST call. Browsers can't set an
 * Authorization header on a WebSocket handshake, which is why this exchange
 * (real key -> short-lived token) exists at all; see Mistral's realtime
 * client-auth docs. No relay/proxy is needed for the audio itself.
 */

import { requireApiKey, mistralRealtimeTranscribeModel, MISTRAL_REALTIME_SESSION_API } from "@/lib/mistral";
import { logServerEvent } from "@/lib/server-log";

export const runtime = "nodejs";

export async function POST() {
  const model = mistralRealtimeTranscribeModel();
  try {
    const res = await fetch(MISTRAL_REALTIME_SESSION_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${requireApiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ purpose: "realtime", model }),
    });

    if (!res.ok) {
      const text = await res.text();
      logServerEvent("realtime_token_error", { status: res.status, body: text.slice(0, 500) });
      return new Response("Failed to mint realtime token", { status: 502 });
    }

    const data = await res.json();
    const token = data?.client_secret?.value;
    const expiresAt = data?.client_secret?.expires_at;
    if (!token) {
      logServerEvent("realtime_token_error", { reason: "no client_secret in response" });
      return new Response("Malformed token response", { status: 502 });
    }

    logServerEvent("realtime_token_minted", { model, expiresAt });
    return Response.json({ token, model, expiresAt });
  } catch (e) {
    logServerEvent("realtime_token_error", { error: String(e instanceof Error ? e.message : e) });
    return new Response("Failed to mint realtime token", { status: 500 });
  }
}
