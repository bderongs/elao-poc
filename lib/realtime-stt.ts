/**
 * Client-side streaming transcription against Mistral's realtime endpoint
 * (voxtral-mini-transcribe-realtime-2602), replacing the ~1-1.3s wait for a
 * batch /api/transcribe round trip (lib/mistral.ts's mistralTranscribe) with
 * audio sent continuously WHILE the user talks, so the transcript is (near)
 * ready the instant lib/turn-vad.ts's VAD detects silence.
 *
 * Protocol facts below were confirmed empirically (Mistral's public docs only
 * document the Python SDK's abstraction, not the raw wire protocol):
 *  - Auth: browser connects directly to Mistral (no relay) using a short-lived
 *    token minted server-side (app/api/realtime-token), passed as a
 *    Sec-WebSocket-Protocol entry: new WebSocket(url, ["realtime", token]).
 *    A FRESH token is minted for every turn (~200-300ms round trip) rather
 *    than reusing one across reconnects — reusing a single token for a fast
 *    turn-boundary reconnect was observed hanging for ~11s before erroring,
 *    consistent with Mistral allowing only one live connection per token and
 *    the previous turn's socket not having finished tearing down server-side
 *    yet when the next one tried to authenticate with the same token.
 *  - Audio: raw binary WS frames of PCM16LE mono at 16kHz (NOT the mic's
 *    native rate) — see resampleTo16kPcm16 below.
 *  - Finalize: send {"type":"input_audio.end"} (JSON text frame). The server
 *    replies with a single {"type":"transcription.done", text: "..."} event
 *    carrying the FULL final transcript (no need to concatenate the
 *    intermediate {"type":"transcription.text.delta"} events ourselves).
 *  - The server closes the socket right after transcription.done — there is
 *    no multi-turn-per-socket; a fresh WebSocket (and now fresh token) is
 *    opened per turn.
 *  - No word-level timestamps are exposed anywhere in this protocol (a
 *    session.update with timestamp_granularities is explicitly rejected), so
 *    WPM must come from VAD-measured speech duration, not word timing.
 */

const TARGET_SAMPLE_RATE = 16000;
const FINALIZE_TIMEOUT_MS = 2000;
const TOKEN_ENDPOINT = "/api/realtime-token";

type TurnSocketState = "connecting" | "open" | "closed" | "error";

interface DoneWaiter {
  resolve: (text: string) => void;
  reject: (err: Error) => void;
}

/**
 * Everything scoped to ONE turn's connection attempt. Deliberately NOT
 * instance fields on RealtimeStt directly — startTurn() replaces `current`
 * wholesale for the next turn (synchronously, before the token-mint fetch
 * even resolves — see startTurn()), but every closure (message/error/close
 * handlers, finalizeTurn()'s promise/timeout) captures its own TurnState by
 * reference, so a fast follow-on startTurn() can never steal or clear a
 * still-in-flight finalizeTurn()'s waiter, or let a superseded mint attempt
 * clobber the turn that came after it.
 */
interface TurnState {
  ws: WebSocket | null; // null until the token-mint fetch resolves and the socket is actually opened
  state: TurnSocketState;
  bytesSent: number;
  doneWaiter: DoneWaiter | null;
}

export type RealtimeSttLifecycleEvent = "ws_open" | "ws_closed" | "ws_error" | "token_error";

export class RealtimeStt {
  private inputSampleRate: number;
  private onLifecycle?: (event: RealtimeSttLifecycleEvent, data?: Record<string, unknown>) => void;

  private current: TurnState | null = null;

  constructor(
    inputSampleRate: number,
    onLifecycle?: (event: RealtimeSttLifecycleEvent, data?: Record<string, unknown>) => void
  ) {
    this.inputSampleRate = inputSampleRate;
    this.onLifecycle = onLifecycle;
  }

  /**
   * Starts a new turn: synchronously claims `current` with a "connecting"
   * placeholder (so pushAudio/finalizeTurn calls that land before the token
   * mint resolves correctly see "not open yet" rather than stale data from
   * the previous turn), then mints a fresh token and opens a fresh socket in
   * the background. Fire-and-forget by design — callers (app/page.tsx) call
   * this immediately after finalizeTurn() for the PREVIOUS turn, without
   * awaiting either, mirroring the existing stopTurnRecording()/
   * startTurnRecording() pattern.
   */
  startTurn(): void {
    const turn: TurnState = { ws: null, state: "connecting", bytesSent: 0, doneWaiter: null };
    this.current = turn;
    void this.mintAndConnect(turn);
  }

  private async mintAndConnect(turn: TurnState): Promise<void> {
    let token: string;
    let model: string;
    try {
      const res = await fetch(TOKEN_ENDPOINT, { method: "POST" });
      if (!res.ok) throw new Error(`token fetch ${res.status}`);
      const data = await res.json();
      token = data.token;
      model = data.model;
      if (!token || !model) throw new Error("malformed token response");
    } catch (e) {
      turn.state = "error";
      this.onLifecycle?.("token_error", { message: String(e instanceof Error ? e.message : e) });
      return;
    }

    // A newer startTurn() already replaced `current` while the mint was in
    // flight (e.g. this turn was abandoned) — don't open a socket nobody will use.
    if (this.current !== turn) return;

    let ws: WebSocket;
    try {
      const url = `wss://api.mistral.ai/v1/audio/transcriptions/realtime?model=${encodeURIComponent(model)}`;
      ws = new WebSocket(url, ["realtime", token]);
      ws.binaryType = "arraybuffer";
    } catch {
      turn.state = "error";
      return;
    }
    turn.ws = ws;

    ws.addEventListener("message", (e) => this.handleMessage(turn, e.data));
    ws.addEventListener("error", () => {
      turn.state = "error";
      this.onLifecycle?.("ws_error");
      turn.doneWaiter?.reject(new Error("realtime STT socket error"));
      turn.doneWaiter = null;
    });
    ws.addEventListener("close", (e) => {
      this.onLifecycle?.("ws_closed", { code: e.code, reason: e.reason });
      if (turn.state !== "error") turn.state = "closed";
      // A close before transcription.done arrived (network drop, server hiccup)
      // must still resolve the pending finalizeTurn() promise — otherwise it
      // hangs until FINALIZE_TIMEOUT_MS instead of failing fast.
      turn.doneWaiter?.reject(new Error("realtime STT socket closed before transcription.done"));
      turn.doneWaiter = null;
    });
  }

  private handleMessage(turn: TurnState, data: string | ArrayBuffer) {
    if (typeof data !== "string") return; // no binary messages expected from the server
    let parsed: { type?: string; text?: string; error?: { message?: string } };
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }

    if (parsed.type === "session.created") {
      turn.state = "open";
      this.onLifecycle?.("ws_open");
    } else if (parsed.type === "transcription.done") {
      turn.doneWaiter?.resolve(parsed.text ?? "");
      turn.doneWaiter = null;
    } else if (parsed.type === "error") {
      turn.state = "error";
      this.onLifecycle?.("ws_error", { message: parsed.error?.message });
      turn.doneWaiter?.reject(new Error(parsed.error?.message ?? "realtime STT error"));
      turn.doneWaiter = null;
    }
  }

  /**
   * Feeds one VAD-tapped audio buffer (Float32, at inputSampleRate) into the
   * CURRENT turn's socket. No-ops while it isn't open yet (token still
   * minting, or handshake still in progress) — a turn that starts talking
   * before the connection is ready just loses its first handful of frames,
   * the same tolerance lib/turn-vad.ts's MIN_SPEECH_MS already assumes for noise.
   */
  pushAudio(float32: Float32Array): void {
    const turn = this.current;
    if (!turn || turn.state !== "open" || !turn.ws) return;
    const pcm16 = resampleTo16kPcm16(float32, this.inputSampleRate);
    if (pcm16.byteLength === 0) return;
    turn.ws.send(pcm16);
    turn.bytesSent += pcm16.byteLength;
  }

  /**
   * Signals end-of-turn on the CURRENT turn's socket and resolves with the
   * final transcript text. Rejects immediately (not after the timeout) if no
   * audio was actually sent this turn — e.g. the socket was still connecting
   * when the user finished talking — so the caller can fall back to the
   * batch path fast instead of stalling on a request that was never going to
   * produce anything. Safe to call startTurn() again right after this, even
   * before it resolves: this closure holds its own reference to `turn`, not
   * `this.current`, so a fast follow-on turn can't steal its waiter.
   */
  finalizeTurn(): Promise<string> {
    const turn = this.current;
    if (!turn || turn.bytesSent === 0 || turn.state !== "open" || !turn.ws) {
      return Promise.reject(new Error("realtime STT: no audio sent this turn"));
    }
    const ws = turn.ws;
    return new Promise<string>((resolve, reject) => {
      turn.doneWaiter = { resolve, reject };
      ws.send(JSON.stringify({ type: "input_audio.end" }));
      setTimeout(() => {
        if (turn.doneWaiter) {
          turn.doneWaiter = null;
          reject(new Error("realtime STT: finalize timed out"));
        }
      }, FINALIZE_TIMEOUT_MS);
    });
  }

  /** Session teardown — closes whatever turn-socket is currently open, if any. */
  close(): void {
    if (this.current) {
      this.current.doneWaiter = null;
      try {
        this.current.ws?.close();
      } catch {
        // already closed/closing — fine to ignore
      }
    }
    this.current = null;
  }
}

/**
 * Float32 (native mic rate, e.g. whatever lib/turn-vad.ts's AudioContext
 * ended up at — not necessarily 48000) -> mono Int16 PCM at 16kHz, linearly
 * interpolated. Good enough for ASR input; not intended for playback fidelity.
 */
function resampleTo16kPcm16(float32: Float32Array, inputSampleRate: number): ArrayBuffer {
  if (float32.length === 0) return new ArrayBuffer(0);
  const ratio = inputSampleRate / TARGET_SAMPLE_RATE;
  const outLength = Math.max(0, Math.floor(float32.length / ratio));
  const out = new Int16Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const srcIndex = i * ratio;
    const i0 = Math.floor(srcIndex);
    const i1 = Math.min(i0 + 1, float32.length - 1);
    const frac = srcIndex - i0;
    const sample = float32[i0] + (float32[i1] - float32[i0]) * frac;
    const clamped = Math.max(-1, Math.min(1, sample));
    out[i] = clamped < 0 ? clamped * 32768 : clamped * 32767;
  }
  return out.buffer;
}
