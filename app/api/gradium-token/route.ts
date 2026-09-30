/**
 * Mints a short-lived Gradium token so the browser can open its STT
 * WebSocket (lib/realtime-stt-gradium.ts) directly, without ever seeing
 * GRADIUM_API — browsers can't set the x-api-key header on a WebSocket
 * handshake. Same role as app/api/realtime-token for Mistral. Minted on the
 * EU host, matching the EU socket the client opens.
 */

import { logServerEvent } from "@/lib/server-log";

export const runtime = "nodejs";

const GRADIUM_TOKEN_URL = "https://eu.api.gradium.ai/api/api-keys/token";

export async function POST() {
  const key = process.env.GRADIUM_API;
  if (!key) return new Response("GRADIUM_API not configured", { status: 500 });
  try {
    const res = await fetch(GRADIUM_TOKEN_URL, { headers: { "x-api-key": key } });
    if (!res.ok) {
      logServerEvent("gradium_token_error", { status: res.status, body: (await res.text()).slice(0, 500) });
      return new Response("Failed to mint Gradium token", { status: 502 });
    }
    const data = (await res.json()) as { token?: string; expires_at?: string };
    if (!data.token) {
      logServerEvent("gradium_token_error", { reason: "no token in response" });
      return new Response("Malformed token response", { status: 502 });
    }
    return Response.json({ token: data.token, expiresAt: data.expires_at });
  } catch (e) {
    logServerEvent("gradium_token_error", { error: String(e instanceof Error ? e.message : e) });
    return new Response("Failed to mint Gradium token", { status: 500 });
  }
}
