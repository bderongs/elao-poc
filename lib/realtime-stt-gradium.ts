/**
 * Client-side streaming transcription against Gradium's STT WebSocket
 * (eu.api.gradium.ai/api/speech/asr) — same per-turn contract as
 * lib/realtime-stt.ts (Mistral), chosen per language by
 * lib/realtime-stt-config.ts's REALTIME_STT_PROVIDER_BY_LANG.
 *
 * Why Gradium: its setup message takes the language (json_config.language),
 * which Mistral's realtime endpoint doesn't — see realtime-stt-config.ts.
 *
 * Protocol (docs.gradium.ai, confirmed against the live API 2026-09-30):
 *  - Auth: short-lived token from app/api/gradium-token, passed as ?token=.
 *    Fresh token + socket per turn, like the Mistral client. An idle socket
 *    stays usable for at least 60 s (tested), covering the avatar's turn.
 *  - Client → server: {"type":"setup", model_name, input_format:"pcm_16000",
 *    json_config:{language}} on open; then {"type":"audio", audio:<base64
 *    PCM16LE mono 16 kHz>}; {"type":"end_of_stream"} to finish.
 *  - Server → client: "ready" (setup accepted), "text" segments (a word or
 *    a few), "end_text", "step" (semantic VAD, every 80 ms — unused here),
 *    "error", and a final "end_of_stream" once all pending text is flushed
 *    (~0.4 s after ours in tests). The transcript is the "text" segments
 *    joined with spaces.
 */

import type { ConvLang } from "@/lib/conversation-prompts";
import { resampleTo16kPcm16, type RealtimeSttLifecycleEvent, type StreamingStt } from "@/lib/realtime-stt";

const TOKEN_ENDPOINT = "/api/gradium-token";
const GRADIUM_ASR_URL = "wss://eu.api.gradium.ai/api/speech/asr";
const FINALIZE_TIMEOUT_MS = 2500;

/** Gradium STT covers en/fr/de/es/pt only — callers must not construct this for other languages. */
const GRADIUM_LANG: Partial<Record<ConvLang, string>> = { en: "en", fr: "fr", de: "de", es: "es" };

type TurnSocketState = "connecting" | "open" | "closed" | "error";

interface TurnState {
  ws: WebSocket | null;
  state: TurnSocketState;
  bytesSent: number;
  texts: string[];
  doneWaiter: { resolve: (text: string) => void; reject: (err: Error) => void } | null;
}

export class GradiumRealtimeStt implements StreamingStt {
  private current: TurnState | null = null;

  constructor(
    private inputSampleRate: number,
    private language: ConvLang,
    private onLifecycle?: (event: RealtimeSttLifecycleEvent, data?: Record<string, unknown>) => void,
  ) {}

  /** Same fire-and-forget contract as RealtimeStt.startTurn (see lib/realtime-stt.ts). */
  startTurn(): void {
    const turn: TurnState = { ws: null, state: "connecting", bytesSent: 0, texts: [], doneWaiter: null };
    this.current = turn;
    void this.mintAndConnect(turn);
  }

  private async mintAndConnect(turn: TurnState): Promise<void> {
    const language = GRADIUM_LANG[this.language];
    let token: string;
    try {
      if (!language) throw new Error(`Gradium STT does not support ${this.language}`);
      const res = await fetch(TOKEN_ENDPOINT, { method: "POST" });
      if (!res.ok) throw new Error(`token fetch ${res.status}`);
      token = (await res.json()).token;
      if (!token) throw new Error("malformed token response");
    } catch (e) {
      turn.state = "error";
      this.onLifecycle?.("token_error", { provider: "gradium", message: String(e instanceof Error ? e.message : e) });
      return;
    }
    if (this.current !== turn) return; // superseded while minting

    let ws: WebSocket;
    try {
      ws = new WebSocket(`${GRADIUM_ASR_URL}?token=${encodeURIComponent(token)}`);
    } catch {
      turn.state = "error";
      return;
    }
    turn.ws = ws;

    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ type: "setup", model_name: "default", input_format: "pcm_16000", json_config: { language } }));
    });
    ws.addEventListener("message", (e) => this.handleMessage(turn, e.data));
    ws.addEventListener("error", () => {
      turn.state = "error";
      this.onLifecycle?.("ws_error", { provider: "gradium" });
      turn.doneWaiter?.reject(new Error("Gradium STT socket error"));
      turn.doneWaiter = null;
    });
    ws.addEventListener("close", (e) => {
      this.onLifecycle?.("ws_closed", { provider: "gradium", code: e.code, reason: e.reason });
      if (turn.state !== "error") turn.state = "closed";
      turn.doneWaiter?.reject(new Error("Gradium STT socket closed before end_of_stream"));
      turn.doneWaiter = null;
    });
  }

  private handleMessage(turn: TurnState, data: unknown) {
    if (typeof data !== "string") return;
    let msg: { type?: string; text?: string; message?: string };
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (msg.type === "ready") {
      turn.state = "open";
      this.onLifecycle?.("ws_open", { provider: "gradium" });
    } else if (msg.type === "text") {
      if (msg.text) turn.texts.push(msg.text);
    } else if (msg.type === "end_of_stream") {
      turn.doneWaiter?.resolve(turn.texts.join(" ").replace(/\s+/g, " ").trim());
      turn.doneWaiter = null;
    } else if (msg.type === "error") {
      turn.state = "error";
      this.onLifecycle?.("ws_error", { provider: "gradium", message: msg.message });
      turn.doneWaiter?.reject(new Error(msg.message ?? "Gradium STT error"));
      turn.doneWaiter = null;
    }
  }

  /** No-op until the server's "ready" — same early-frame tolerance as RealtimeStt.pushAudio. */
  pushAudio(float32: Float32Array): void {
    const turn = this.current;
    if (!turn || turn.state !== "open" || !turn.ws) return;
    const pcm16 = resampleTo16kPcm16(float32, this.inputSampleRate);
    if (pcm16.byteLength === 0) return;
    turn.ws.send(JSON.stringify({ type: "audio", audio: toBase64(pcm16) }));
    turn.bytesSent += pcm16.byteLength;
  }

  /** Same contract as RealtimeStt.finalizeTurn: rejects fast when nothing was streamed, so the caller falls back to batch. */
  finalizeTurn(): Promise<string> {
    const turn = this.current;
    if (!turn || turn.bytesSent === 0 || turn.state !== "open" || !turn.ws) {
      return Promise.reject(new Error("Gradium STT: no audio sent this turn"));
    }
    const ws = turn.ws;
    return new Promise<string>((resolve, reject) => {
      turn.doneWaiter = { resolve, reject };
      ws.send(JSON.stringify({ type: "end_of_stream" }));
      setTimeout(() => {
        if (turn.doneWaiter) {
          turn.doneWaiter = null;
          reject(new Error("Gradium STT: finalize timed out"));
        }
      }, FINALIZE_TIMEOUT_MS);
    });
  }

  close(): void {
    if (this.current) {
      this.current.doneWaiter = null;
      try {
        this.current.ws?.close();
      } catch {
        // already closed/closing
      }
    }
    this.current = null;
  }
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
