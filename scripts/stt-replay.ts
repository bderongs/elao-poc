/**
 * Z-09/Z-10 — replay a stored turn WAV through Mistral realtime STT, the way
 * the browser does it (lib/realtime-stt.ts): 16 kHz PCM16 frames, then
 * input_audio.end, then read transcription.done. Compare with what the live
 * session stored and with Deepgram.
 *
 *   npx tsx scripts/stt-replay.ts <wav-url-or-path> [--pace realtime|fast] [--tail-ms N]
 *
 * --pace realtime  sends frames at 1x speed (like a live mic)      (default)
 * --pace fast      sends everything at once
 * --tail-ms N      appends N ms of digital silence before input_audio.end
 */
import { existsSync, writeFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
for (const f of [".env", ".env.local"]) if (existsSync(f)) process.loadEnvFile(f);
import { requireApiKey, mistralRealtimeTranscribeModel, MISTRAL_REALTIME_SESSION_API } from "../lib/mistral";

const args = process.argv.slice(2);
const src = args[0];
const opt = (n: string, d: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const PACE = opt("pace", "realtime");
const TAIL_MS = Number(opt("tail-ms", "0"));

async function main() {
  const tmp = process.env.TMPDIR ?? "/tmp";
  let wav = `${tmp}/replay-in.wav`;
  if (/^https?:/.test(src)) writeFileSync(wav, Buffer.from(await (await fetch(src)).arrayBuffer()));
  else wav = src;
  const pcmPath = `${tmp}/replay-out.pcm`;
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", wav, "-ac", "1", "-ar", "16000", "-f", "s16le", pcmPath]);
  const pcm = readFileSync(pcmPath);
  console.log(`audio: ${(pcm.length / 32000).toFixed(1)} s, pace=${PACE}, tail=${TAIL_MS}ms`);

  const model = mistralRealtimeTranscribeModel();
  const tok = await (await fetch(MISTRAL_REALTIME_SESSION_API, {
    method: "POST",
    headers: { Authorization: `Bearer ${requireApiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ purpose: "realtime", model }),
  })).json();
  const token = tok.client_secret.value;

  const ws = new WebSocket(`wss://api.mistral.ai/v1/audio/transcriptions/realtime?model=${encodeURIComponent(model)}`, ["realtime", token]);
  ws.binaryType = "arraybuffer";
  const events: string[] = [];
  const T0 = Date.now();
  const done = new Promise<string>((resolve) => {
    ws.addEventListener("message", (e) => {
      const m = JSON.parse(String(e.data));
      events.push(m.type + (m.type === "transcription.text.delta" ? `(${(m.text ?? "").length})` : "") + `@${((Date.now() - T0) / 1000).toFixed(1)}s`);
      if (m.type === "transcription.done") resolve(m.text ?? "");
      if (m.type === "error") { console.log("ERROR", JSON.stringify(m)); resolve(""); }
    });
    ws.addEventListener("close", () => resolve("(closed before done)"));
  });
  await new Promise<void>((r) => ws.addEventListener("open", () => r()));
  // wait for session.created like the browser does
  await new Promise((r) => setTimeout(r, 300));

  const FRAME = 4096 * 2 * (16000 / 48000) * 1; // ≈ one 4096-sample @48k browser buffer in 16k bytes
  const frame = Math.round(FRAME / 2) * 2;
  const t0 = Date.now();
  let sent = 0;
  const sendAll = async (buf: Buffer) => {
    for (let o = 0; o < buf.length; o += frame) {
      ws.send(buf.subarray(o, o + frame));
      sent += Math.min(frame, buf.length - o);
      if (PACE === "realtime") await new Promise((r) => setTimeout(r, (frame / 32000) * 1000));
    }
  };
  await sendAll(pcm);
  if (TAIL_MS > 0) await sendAll(Buffer.alloc(Math.round((TAIL_MS / 1000) * 32000)));
  ws.send(JSON.stringify({ type: "input_audio.end" }));
  const text = await Promise.race([done, new Promise<string>((r) => setTimeout(() => r("(timeout 8s)"), 8000))]);
  console.log(`done after ${Date.now() - t0} ms (sent ${(sent / 32000).toFixed(1)} s)`);
  console.log(`words: ${text.split(/\s+/).filter(Boolean).length}`);
  console.log(text);
  const nd = events.filter((e) => e.startsWith("transcription.text.delta"));
  console.log("events:", events.filter((e) => !e.startsWith("transcription.text.delta")).join(", "), `+${nd.length} deltas`, nd.length ? `(first ${nd[0]}, last ${nd[nd.length - 1]})` : "");
  ws.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
