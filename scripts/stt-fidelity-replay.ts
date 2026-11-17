/**
 * Do our transcription engines write down what was SAID, or what the speaker
 * probably MEANT? The failure that took Voxtral off live scoring (2026-09-09,
 * lib/pronunciation-rollup.ts) was a transcript invented on weak audio — fluent
 * text the speaker never produced. Any pronunciation score built on a
 * transcript inherits that failure, so this measures it per engine, per level.
 *
 * Engines (each on the same stored WAV):
 *   - voxtral-mini-latest            the live "second hearing" since A-02/A-03
 *   - voxtral-mini-transcribe-3      Mistral's new fast transcription model
 *   - voxtral-small-transcribe-3     Mistral's new most-accurate model (default, and temperature 0)
 *   - gradium                        Gradium batch STT, EU (default, and temp 0) — en/fr/de/es/pt only
 *   - deepgram nova-3                the previous second hearing, as a yardstick
 *
 * There is no human transcript. Measures, for every engine:
 *   - WER vs Speechace's own transcript (the reference report's ASR), on
 *     filler-free normalized words;
 *   - "unheard": share of the engine's words that NO other engine nor
 *     Speechace heard in that turn — invented words show up here;
 *   - length ratio vs the median of the other hearings (invented clauses
 *     make a transcript longer, a dropped one shorter);
 *   - the worst turns side by side, to check by ear.
 *
 *   npx tsx scripts/stt-fidelity-replay.ts                       # 3 calibration sessions per oral level, 5 turns
 *   npx tsx scripts/stt-fidelity-replay.ts --per-level 5 --levels A1,A2
 *   npx tsx scripts/stt-fidelity-replay.ts --engines voxtral-small-t0,gradium-t0
 *
 * Audio goes to Mistral, Gradium (EU) and Deepgram — the providers the app
 * already uses. Read-only on the database. Writes sim-runs/stt-fidelity-<ts>.md.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
for (const f of [".env", ".env.local"]) if (existsSync(f)) process.loadEnvFile(f);

import { getSupabaseServer } from "../lib/supabase-server";
import { recordingPath } from "../lib/recordings";
import { deepgramVerbatim } from "../lib/pronunciation/verbatim";
import { requireApiKey } from "../lib/mistral";
import type { SpeechaceScores } from "../lib/types";

const args = process.argv.slice(2);
const opt = (name: string, def?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const PER_LEVEL = Number(opt("per-level", "3"));
const MAX_TURNS = Number(opt("max-turns", "5"));
const LEVELS = (opt("levels", "A1,A2,B1,B2,C1,C2") as string).split(",");
const SESSION_IDS = opt("sessions")?.split(",");
const CONCURRENCY = Number(opt("concurrency", "3"));

// ─── Engines ────────────────────────────────────────────────────────────────

interface Hearing { text: string | null; ms: number; error?: string }
interface Engine { id: string; label: string; langs?: string[]; run: (audio: ArrayBuffer, lang: string) => Promise<Hearing> }

const base = (lang: string) => lang.split("-")[0];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function mistral(model: string, audio: ArrayBuffer, lang: string, temperature?: number): Promise<Hearing> {
  for (let attempt = 0; ; attempt++) {
    const form = new FormData();
    form.append("file", new Blob([audio], { type: "audio/wav" }), "turn.wav");
    form.append("model", model);
    form.append("language", base(lang));
    if (temperature !== undefined) form.append("temperature", String(temperature));
    const t0 = Date.now();
    try {
      const res = await fetch("https://api.mistral.ai/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${requireApiKey()}` }, body: form, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if ((res.status === 429 || res.status >= 500) && attempt < 4) { await sleep(5000 * (attempt + 1)); continue; }
      if (!res.ok) return { text: null, ms: Date.now() - t0, error: `http ${res.status}: ${(await res.text()).slice(0, 150)}` };
      const data = (await res.json()) as { text?: string };
      return { text: (data.text ?? "").trim(), ms: Date.now() - t0 };
    } catch (e) {
      // Connection dropped or timed out, possibly mid-body: retry, then give up on this hearing only.
      if (attempt < 3) { await sleep(5000 * (attempt + 1)); continue; }
      return { text: null, ms: Date.now() - t0, error: `network: ${String(e)}` };
    }
  }
}

const TIMEOUT_MS = 90_000;

// Gradium caps the account at 3 active sessions, and production's examiner
// voice (TTS) may share that cap: one Gradium call at a time here.
let gradiumGate: Promise<unknown> = Promise.resolve();
function gradium(audio: ArrayBuffer, lang: string, temp?: number): Promise<Hearing> {
  const run = gradiumGate.then(() => gradiumCall(audio, lang, temp));
  gradiumGate = run.catch(() => undefined);
  return run;
}

async function gradiumCall(audio: ArrayBuffer, lang: string, temp?: number): Promise<Hearing> {
  const key = process.env.GRADIUM_API;
  if (!key) return { text: null, ms: 0, error: "GRADIUM_API missing" };
  const config = { language: base(lang), ...(temp !== undefined ? { temp } : {}) };
  for (let attempt = 0; ; attempt++) {
    const t0 = Date.now();
    let body: string;
    try {
      const res = await fetch(`https://eu.api.gradium.ai/api/speech/asr?json_config=${encodeURIComponent(JSON.stringify(config))}`, {
        method: "POST",
        headers: { "x-api-key": key, "Content-Type": "audio/wav" },
        body: audio,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      // 400 "Concurrency limit exceeded" too: someone else (production TTS?) holds the sessions — wait and retry.
      const busy = res.status === 400 && (await res.clone().text()).includes("Concurrency limit");
      if ((busy || res.status === 429 || res.status >= 500) && attempt < 4) { await sleep(5000 * (attempt + 1)); continue; }
      if (!res.ok) return { text: null, ms: Date.now() - t0, error: `http ${res.status}: ${(await res.text()).slice(0, 150)}` };
      body = await res.text();
    } catch (e) {
      if (attempt < 3) { await sleep(5000 * (attempt + 1)); continue; }
      return { text: null, ms: Date.now() - t0, error: `network: ${String(e)}` };
    }
    const ms = Date.now() - t0;
    // Newline-delimited JSON: {"type":"text","text":...} per segment, possibly an {"type":"error"}.
    const parts: string[] = [];
    for (const line of body.split("\n")) {
      if (!line.trim()) continue;
      let msg: { type?: string; text?: string; message?: string };
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.type === "text" && msg.text) parts.push(msg.text);
      if (msg.type === "error") return { text: null, ms, error: `gradium: ${msg.message ?? line.slice(0, 150)}` };
    }
    return { text: parts.join(" ").replace(/\s+/g, " ").trim(), ms };
  }
}

const GRADIUM_LANGS = ["en", "fr", "de", "es", "pt"];
const ALL_ENGINES: Engine[] = [
  { id: "voxtral-mini", label: "voxtral-mini-latest (live)", run: (a, l) => mistral("voxtral-mini-latest", a, l) },
  { id: "voxtral-mini-3", label: "voxtral-mini-transcribe-3", run: (a, l) => mistral("voxtral-mini-transcribe-3", a, l) },
  { id: "voxtral-small-3", label: "voxtral-small-transcribe-3", run: (a, l) => mistral("voxtral-small-transcribe-3", a, l) },
  { id: "voxtral-small-t0", label: "voxtral-small-transcribe-3, temperature 0", run: (a, l) => mistral("voxtral-small-transcribe-3", a, l, 0) },
  { id: "gradium", label: "Gradium (EU)", langs: GRADIUM_LANGS, run: (a, l) => gradium(a, l) },
  { id: "gradium-t0", label: "Gradium (EU), temp 0", langs: GRADIUM_LANGS, run: (a, l) => gradium(a, l, 0) },
  {
    id: "deepgram",
    label: "Deepgram nova-3",
    run: async (a, l) => {
      const t0 = Date.now();
      const r = await deepgramVerbatim(a, "audio/wav", l);
      return { text: r?.transcript ?? null, ms: Date.now() - t0, error: r ? undefined : "no result" };
    },
  },
];
const ENGINES = opt("engines") ? ALL_ENGINES.filter((e) => opt("engines")!.split(",").includes(e.id)) : ALL_ENGINES;

// ─── Text measures ──────────────────────────────────────────────────────────

const FILLERS = new Set(["eum", "euh", "heu", "uh", "um", "umm", "er", "erm", "eh", "ehm", "äh", "ähm", "eeh", "hm", "hmm", "mm", "mhm", "ah", "oh"]);
const words = (s: string) =>
  s.toLowerCase().normalize("NFC").replace(/[’'`-]/g, " ").replace(/[^\p{L}\p{N} ]+/gu, " ").split(/\s+/).filter((w) => w && !FILLERS.has(w));

function editDistance(a: string[], b: string[]): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const pct = (x: number) => (Number.isFinite(x) ? `${Math.round(x * 1000) / 10} %` : "—");
const r2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : "—");

// ─── Sample ─────────────────────────────────────────────────────────────────

interface Turn { id: string; session: string; lang: string; oral: string; index: number; speechace: string; audioUrl: string }

const levelOf = (s: string | null | undefined) => {
  const l = (s ?? "").replace(/\s*\(.*\)|\.\d+/g, "").replace("+", "").trim().toUpperCase();
  return ["A1", "A2", "B1", "B2", "C1", "C2"].includes(l) ? l : null;
};

async function loadTurns(): Promise<Turn[]> {
  const sb = getSupabaseServer();
  const { data, error } = await sb.from("sessions").select("id, language, speechace_scores").eq("source", "speechace")
    .eq("speechace_scores->reference->>calibration", "true").order("id");
  if (error) throw error;
  const all = (data ?? [])
    .map((s) => ({ id: s.id as string, lang: s.language as string, oral: levelOf((s.speechace_scores as SpeechaceScores).reference?.oral_level) }))
    .filter((s): s is { id: string; lang: string; oral: string } => s.oral !== null)
    .filter((s) => !SESSION_IDS || SESSION_IDS.some((p) => s.id.startsWith(p)));

  // PER_LEVEL per oral level, languages taken in turn.
  const picked = SESSION_IDS ? all : LEVELS.flatMap((lvl) => {
    const byLang = new Map<string, typeof all>();
    for (const s of all.filter((x) => x.oral === lvl)) byLang.set(s.lang, [...(byLang.get(s.lang) ?? []), s]);
    const queues = [...byLang.values()];
    const out: typeof all = [];
    for (let i = 0; out.length < PER_LEVEL && queues.some((q) => q.length > i); i++) for (const q of queues) if (q[i] && out.length < PER_LEVEL) out.push(q[i]);
    return out;
  });

  const { data: rows, error: tErr } = await sb.from("session_turns").select("id, session_id, turn_index, role, content, audio_url")
    .in("session_id", picked.map((s) => s.id)).eq("role", "user").order("turn_index");
  if (tErr) throw tErr;
  return picked.flatMap((s) =>
    (rows ?? []).filter((t) => t.session_id === s.id && t.audio_url && ((t.content as string) ?? "").trim())
      .slice(0, MAX_TURNS)
      .map((t) => ({ id: t.id as string, session: s.id, lang: s.lang, oral: s.oral, index: t.turn_index as number, speechace: (t.content as string).trim(), audioUrl: t.audio_url as string })),
  );
}

async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (next < items.length) await fn(items[next++]); }));
}

// ─── Run ────────────────────────────────────────────────────────────────────

interface Row { turn: Turn; hearings: Record<string, Hearing> }

async function main() {
  const turns = await loadTurns();
  console.log(`${turns.length} turns from ${new Set(turns.map((t) => t.session)).size} calibration sessions · engines: ${ENGINES.map((e) => e.id).join(", ")}`);
  const sb = getSupabaseServer();
  const rows: Row[] = [];
  let done = 0;
  await pool(turns, CONCURRENCY, async (turn) => {
    try {
      const path = recordingPath(turn.audioUrl);
      const blob = path ? (await sb.storage.from("recordings").download(path)).data : await fetch(turn.audioUrl).then((r) => (r.ok ? r.blob() : null));
      if (!blob) return;
      const audio = await blob.arrayBuffer();
      const engines = ENGINES.filter((e) => !e.langs || e.langs.includes(base(turn.lang)));
      const results = await Promise.all(engines.map((e) => e.run(audio, turn.lang).catch((err) => ({ text: null, ms: 0, error: String(err) }))));
      rows.push({ turn, hearings: Object.fromEntries(engines.map((e, i) => [e.id, results[i]])) });
      console.log(`[${++done}/${turns.length}] ${turn.oral} ${turn.lang} ${turn.session.slice(0, 8)}#${turn.index} ${engines.map((e, i) => `${e.id}:${results[i].text === null ? "fail" : words(results[i].text!).length}`).join(" ")}`);
    } catch (e) {
      // One turn's failure (e.g. its recording download) must not stop the run.
      console.warn(`[skip] ${turn.session.slice(0, 8)}#${turn.index}: ${String(e)}`);
    }
  });
  report(rows);
}

// ─── Report ─────────────────────────────────────────────────────────────────

interface Measure { wer: number; unheard: number; unheardCount: number; lenRatio: number }

function measure(row: Row, id: string): Measure | null {
  const h = row.hearings[id];
  if (!h || h.text === null) return null;
  const mine = words(h.text);
  const ref = words(row.turn.speechace);
  const others = [ref, ...Object.entries(row.hearings).filter(([k, o]) => k !== id && o.text !== null && !sameFamily(k, id)).map(([, o]) => words(o.text!))];
  const heardElsewhere = new Set(others.flat());
  // Numbers written as digits ("2 ans" vs "deux ans") are a formatting choice, not an invention.
  const unheardCount = mine.filter((w) => !/\d/.test(w) && !heardElsewhere.has(w)).length;
  const otherLens = others.map((o) => o.length).filter((n) => n > 0);
  return {
    wer: ref.length ? editDistance(ref, mine) / ref.length : NaN,
    unheard: mine.length ? unheardCount / mine.length : 0,
    unheardCount,
    lenRatio: otherLens.length ? mine.length / median(otherLens) : NaN,
  };
}

// Two runs of the same model (e.g. voxtral-small-3 and voxtral-small-t0) would
// vouch for each other's inventions — exclude the sibling from "heard elsewhere".
function sameFamily(a: string, b: string): boolean {
  const fam = (x: string) => (x.startsWith("voxtral-small") ? "voxtral-small" : x.startsWith("gradium") ? "gradium" : x);
  return fam(a) === fam(b);
}

function report(rows: Row[]) {
  const levels = ["A1", "A2", "B1", "B2", "C1", "C2"].filter((l) => rows.some((r) => r.turn.oral === l));
  const out: string[] = [
    `# Transcription fidelity — ${new Date().toISOString().slice(0, 16)}\n`,
    `${rows.length} turns from ${new Set(rows.map((r) => r.turn.session)).size} Speechace calibration sessions (${[...new Set(rows.map((r) => r.turn.lang))].join(", ")}). No human transcript: WER is against Speechace's own ASR; "unheard" = share of the engine's words that neither Speechace nor any other engine (siblings of the same model excluded) heard in that turn — where invented words show up. Fillers are ignored.\n`,
    "## Summary\n",
    "| Engine | Turns | Failures | WER vs Speechace | Unheard words | Turns with ≥ 25 % unheard | Length vs others (median) | p50 s |",
    "|---|---|---|---|---|---|---|---|",
  ];
  for (const e of ENGINES) {
    const rs = rows.filter((r) => r.hearings[e.id]);
    const ms = rs.map((r) => measure(r, e.id)).filter((m): m is Measure => m !== null);
    out.push(`| ${e.label} | ${rs.length} | ${rs.length - ms.length} | ${pct(mean(ms.map((m) => m.wer).filter(Number.isFinite)))} | ${pct(mean(ms.map((m) => m.unheard)))} | ${ms.filter((m) => m.unheard >= 0.25).length} | ${r2(median(ms.map((m) => m.lenRatio).filter(Number.isFinite)))} | ${r2(median(rs.map((r) => r.hearings[e.id].ms / 1000)))} |`);
  }

  out.push("\n## Unheard words by oral level\n", `| Engine | ${levels.join(" | ")} |`, `|---|${levels.map(() => "---").join("|")}|`);
  for (const e of ENGINES) {
    out.push(`| ${e.label} | ${levels.map((l) => pct(mean(rows.filter((r) => r.turn.oral === l).map((r) => measure(r, e.id)).filter((m): m is Measure => m !== null).map((m) => m.unheard)))).join(" | ")} |`);
  }
  out.push("\n## WER vs Speechace by oral level\n", `| Engine | ${levels.join(" | ")} |`, `|---|${levels.map(() => "---").join("|")}|`);
  for (const e of ENGINES) {
    out.push(`| ${e.label} | ${levels.map((l) => pct(mean(rows.filter((r) => r.turn.oral === l).map((r) => measure(r, e.id)).filter((m): m is Measure => m !== null).map((m) => m.wer).filter(Number.isFinite)))).join(" | ")} |`);
  }

  // Worst turns: highest unheard share for any engine — listen to these.
  const scored = rows.map((r) => ({ r, worst: Math.max(...ENGINES.map((e) => measure(r, e.id)?.unheard ?? 0)) })).sort((a, b) => b.worst - a.worst).slice(0, 15);
  out.push("\n## Turns to check by ear (most unheard words)\n");
  for (const { r } of scored) {
    out.push(`### ${r.turn.oral} ${r.turn.lang} — session ${r.turn.session.slice(0, 8)}, turn ${r.turn.index} (turn id ${r.turn.id})\n`);
    out.push(`- **Speechace**: ${r.turn.speechace}`);
    for (const e of ENGINES) {
      const h = r.hearings[e.id];
      if (!h) continue;
      const m = measure(r, e.id);
      out.push(`- **${e.id}**${m ? ` (unheard ${pct(m.unheard)})` : ""}: ${h.text ?? `fail — ${h.error}`}`);
    }
    out.push("");
  }

  const failures = rows.flatMap((r) => Object.entries(r.hearings).filter(([, h]) => h.text === null).map(([id, h]) => `${id}: ${h.error}`));
  if (failures.length) out.push("## Failures\n", ...[...new Set(failures)].slice(0, 20).map((f) => `- ${f}`));

  mkdirSync("sim-runs", { recursive: true });
  const file = `sim-runs/stt-fidelity-${new Date().toISOString().slice(0, 16).replace(":", "-")}.md`;
  writeFileSync(file, out.join("\n") + "\n");
  console.log(out.slice(0, out.indexOf("\n## Turns to check by ear (most unheard words)\n")).join("\n"));
  console.log(`\nWritten ${file}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
