/**
 * Can a current audio LLM grade pronunciation directly? Runs several audio
 * models (through OpenRouter, one key) on a sample of the calibration set and
 * compares their scores with Speechace and with our stored engines
 * (azure-ensemble, live; voxtral, the earlier direct-audio comparison).
 *
 * Two prompts per model:
 *   - listen:     the model transcribes and judges on its own (the prompt of
 *                 lib/pronunciation/providers/voxtral.ts). Also checks how far
 *                 its transcript is from the stored one, to catch the
 *                 "invented transcript" failure seen on weak A1/A2 audio.
 *   - transcript: the model gets the stored transcript and rates only how the
 *                 speech sounds, on a CEFR-anchored 0-100 scale.
 * Each variant runs twice (--runs) to measure its own run-to-run noise.
 *
 * Speechace scores are per session, so comparisons are on session means.
 * With 12 sessions a correlation of ±0.3 is within chance: read the levels
 * table and the big gaps before the decimals.
 *
 *   npx tsx scripts/audio-judge-replay.ts --list          # audio-input models on OpenRouter
 *   npx tsx scripts/audio-judge-replay.ts --dry-run       # sample + models + number of calls, no model call
 *   npx tsx scripts/audio-judge-replay.ts                 # 2 sessions per oral level A1–C2, 5 turns, 2 runs
 *   npx tsx scripts/audio-judge-replay.ts --models google/gemini-3-flash-preview,openai/gpt-audio --prompts transcript --runs 1
 *   npx tsx scripts/audio-judge-replay.ts --per-level 3 --lang fr,en --concurrency 6
 *   npx tsx scripts/audio-judge-replay.ts <same options> --resume analysis/reports/audio-judge-<ts>.jsonl   # finish an interrupted run
 *
 * Needs OPENROUTER_API_KEY (in .env.local). Candidate recordings are sent to
 * OpenRouter with zero-data-retention and no-training enforced; models with no
 * such endpoint then fail ("no endpoints") — --allow-retention lifts that for
 * every model, --allow-retention-for <model,...> for the listed ones only.
 *
 * Read-only on the database. Writes analysis/reports/audio-judge-<ts>.md and
 * a .jsonl of every call (git-ignored).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
for (const f of [".env", ".env.local"]) if (existsSync(f)) process.loadEnvFile(f);

import { getSupabaseServer } from "../lib/supabase-server";
import { recordingPath } from "../lib/recordings";
import { SYSTEM_PROMPT as LISTEN_SYSTEM } from "../lib/pronunciation/providers/voxtral";
import type { SpeechaceScores } from "../lib/types";

// ─── Options ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const opt = (name: string, def?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const LIST = args.includes("--list");
const DRY = args.includes("--dry-run");
const ALLOW_RETENTION = args.includes("--allow-retention");
/** Models allowed to run on endpoints without zero-data-retention, the others keeping it (e.g. qwen/qwen3.8-omni-flash, hosted by Alibaba only). */
const RETENTION_FOR = opt("allow-retention-for")?.split(",") ?? [];
const retentionAllowed = (model: string) => ALLOW_RETENTION || RETENTION_FOR.includes(model);
const retentionLabel = ALLOW_RETENTION ? "allowed" : RETENTION_FOR.length ? `ZDR + no training, except ${RETENTION_FOR.join(", ")}` : "ZDR + no training enforced";
const PER_LEVEL = Number(opt("per-level", "2"));
const MAX_TURNS = Number(opt("max-turns", "5"));
const RUNS = Number(opt("runs", "2"));
const CONCURRENCY = Number(opt("concurrency", "4"));
const PROMPTS = (opt("prompts", "listen,transcript") as string).split(",") as PromptId[];
const LANGS = opt("lang")?.split(",");
const SESSION_IDS = opt("sessions")?.split(",");
const MODELS_ARG = opt("models")?.split(",");
/** A previous run's .jsonl: its calls are kept and skipped, the new ones appended to it. */
const RESUME = opt("resume");

const OPENROUTER = "https://openrouter.ai/api/v1";
const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];

type PromptId = "listen" | "transcript";

// ─── Prompts ────────────────────────────────────────────────────────────────

const TRANSCRIPT_SYSTEM = `You are an experienced oral examiner rating the PRONUNCIATION of a second-language learner. You hear the learner's recording.

A transcript made by a separate speech recognizer is given only so you know which words were said; it may contain recognition errors. Do NOT judge grammar, vocabulary, content or how well ideas are developed. Judge only how the speech SOUNDS: individual sounds, word stress, rhythm, intonation, and how easy it is to understand.

Rate phonological control on this scale (CEFR):
- 90-100: native or near-native; accent barely noticeable (C2)
- 80-89: clear and natural; slight accent that never gets in the way (C1)
- 70-79: generally clear; noticeable foreign accent, occasional mispronunciations that rarely impede (B2)
- 60-69: intelligible; marked accent, errors in sounds and stress sometimes need effort from the listener (B1)
- 45-59: understandable with effort; strong accent, frequent errors (A2)
- 25-44: often hard to understand (A1)
- 0-24: largely unintelligible
Use the whole range. Place each speaker by what you actually hear; do not default to the middle, and do not reward a speaker for saying simple things correctly.

Return ONLY JSON, no markdown:
{"accent": <1-9, 1 = no foreign accent, 9 = extremely strong>, "comprehensibility": <1-9, 1 = very easy to understand, 9 = very hard>, "turn_score": <0-100 integer>, "main_issues": "<one short sentence>"}`;

const LANG_LABELS: Record<string, string> = {
  fr: "French", "nl-BE": "Dutch (Belgian)", "nl-NL": "Dutch (Netherlands)", es: "Spanish", it: "Italian", de: "German", en: "English",
};

function userText(prompt: PromptId, lang: string, question: string, transcript: string): string {
  const head = `Language the learner is speaking: ${LANG_LABELS[lang] ?? lang}.\n` + (question ? `The question they were answering: "${question}"\n` : "");
  return prompt === "listen"
    ? head + "Listen to the attached audio and assess the pronunciation as instructed."
    : head + `Transcript (separate recognizer, may contain errors): "${transcript}"\nListen to the attached audio and rate the pronunciation as instructed.`;
}

// ─── OpenRouter ─────────────────────────────────────────────────────────────

interface OrModel {
  id: string;
  name?: string;
  created?: number;
  architecture?: { input_modalities?: string[] };
  pricing?: Record<string, string>;
}

async function audioModels(): Promise<OrModel[]> {
  const res = await fetch(`${OPENROUTER}/models`);
  if (!res.ok) throw new Error(`OpenRouter /models: HTTP ${res.status}`);
  const { data } = (await res.json()) as { data: OrModel[] };
  return data.filter((m) => m.architecture?.input_modalities?.includes("audio"));
}

// One model per family, the newest — so the defaults follow new releases.
// customtools: Gemini's tool-calling variant; :batch: the batch-API twin of a model.
const EXCLUDE = /tts|lite|image|live|realtime|transcribe|native-audio|customtools|:batch/i;
const FAMILIES: Array<[string, (id: string) => boolean]> = [
  ["Gemini Flash", (id) => id.startsWith("google/gemini-") && id.includes("-flash")],
  ["Gemini Pro", (id) => id.startsWith("google/gemini-") && id.includes("-pro")],
  ["GPT Audio", (id) => /^openai\/gpt-audio(?!-mini)/.test(id)],
  ["GPT Audio Mini", (id) => id.startsWith("openai/gpt-audio-mini")],
  ["Qwen Omni", (id) => /^qwen\/.*omni/i.test(id)],
  ["Voxtral Small", (id) => id.startsWith("mistralai/voxtral-small")],
];

function pickDefaults(models: OrModel[]): string[] {
  const out: string[] = [];
  for (const [, match] of FAMILIES) {
    const m = models.filter((x) => match(x.id) && !EXCLUDE.test(x.id)).sort((a, b) => (b.created ?? 0) - (a.created ?? 0))[0];
    if (m) out.push(m.id);
  }
  return out;
}

interface Call {
  text: string | null;
  ms: number;
  cost: number;
  error?: string;
}

function requireKey(): string {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY missing — add it to .env.local");
  return key;
}

async function callModel(model: string, system: string, text: string, audioB64: string): Promise<Call> {
  const body = {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: [{ type: "text", text }, { type: "input_audio", input_audio: { data: audioB64, format: "wav" } }] },
    ],
    max_tokens: 4000,
    temperature: 0,
    reasoning: { effort: "low" },
    usage: { include: true },
    ...(retentionAllowed(model) ? {} : { provider: { zdr: true, data_collection: "deny" } }),
  };
  const delays = [5_000, 15_000, 30_000];
  for (let attempt = 0; ; attempt++) {
    const t0 = Date.now();
    let res: Response;
    try {
      res = await fetch(`${OPENROUTER}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${requireKey()}`, "Content-Type": "application/json", "X-Title": "ELAO audio-judge replay" },
        body: JSON.stringify(body),
      });
    } catch (e) {
      if (attempt < delays.length) { await sleep(delays[attempt]); continue; }
      return { text: null, ms: Date.now() - t0, cost: 0, error: `network: ${String(e)}` };
    }
    const ms = Date.now() - t0;
    if ((res.status === 429 || res.status >= 500) && attempt < delays.length) {
      await sleep(delays[attempt]);
      continue;
    }
    if (!res.ok) return { text: null, ms, cost: 0, error: `http ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}` };
    let data: {
      choices?: Array<{ message?: { content?: unknown } }>;
      usage?: { cost?: number };
      error?: { message?: string };
    };
    try {
      data = await res.json();
    } catch (e) {
      // The connection can drop while the body streams in (ECONNRESET) — retry like a network error.
      if (attempt < delays.length) { await sleep(delays[attempt]); continue; }
      return { text: null, ms, cost: 0, error: `body: ${String(e)}` };
    }
    if (data.error) return { text: null, ms, cost: 0, error: data.error.message ?? "error" };
    const c = data.choices?.[0]?.message?.content;
    const text = typeof c === "string" ? c : Array.isArray(c) ? c.map((b) => (b && typeof b === "object" && "text" in b ? String((b as { text: unknown }).text) : "")).join("") : null;
    return { text: text?.trim() ? text : null, ms, cost: data.usage?.cost ?? 0, error: text?.trim() ? undefined : "empty reply" };
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The JSON object in a reply, fences or chatter around it tolerated. */
function parseJson(text: string): Record<string, unknown> | null {
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    return JSON.parse(text.slice(a, b + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ─── Transcript overlap (invented-transcript check) ────────────────────────

const tokens = (s: string) => s.toLowerCase().normalize("NFC").replace(/[^\p{L}\p{N}' ]+/gu, " ").split(/\s+/).filter(Boolean);

/** Share of words the two transcripts have in common (multiset), over the longer one. */
function overlap(ref: string, hyp: string): number {
  const r = tokens(ref), h = tokens(hyp);
  if (!r.length || !h.length) return 0;
  const bag = new Map<string, number>();
  for (const w of r) bag.set(w, (bag.get(w) ?? 0) + 1);
  let same = 0;
  for (const w of h) {
    const n = bag.get(w) ?? 0;
    if (n > 0) { same++; bag.set(w, n - 1); }
  }
  return same / Math.max(r.length, h.length);
}
const INVENTED_BELOW = 0.5;

// ─── Stats ──────────────────────────────────────────────────────────────────

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const r1 = (x: number) => (Number.isFinite(x) ? String(Math.round(x * 10) / 10) : "—");
const r2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : "—");
function pearson(xs: number[], ys: number[]): number {
  if (xs.length < 3) return NaN;
  const mx = mean(xs), my = mean(ys);
  let n = 0, dx = 0, dy = 0;
  for (let i = 0; i < xs.length; i++) { n += (xs[i] - mx) * (ys[i] - my); dx += (xs[i] - mx) ** 2; dy += (ys[i] - my) ** 2; }
  return dx && dy ? n / Math.sqrt(dx * dy) : NaN;
}
function ranks(xs: number[]): number[] {
  const idx = xs.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(xs.length);
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    for (let k = i; k <= j; k++) out[idx[k][1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return out;
}
const spearman = (xs: number[], ys: number[]) => pearson(ranks(xs), ranks(ys));
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };

const levelOf = (s: string | null | undefined) => {
  const l = (s ?? "").replace(/\s*\(.*\)|\.\d+/g, "").replace("+", "").trim().toUpperCase();
  return LEVELS.includes(l) ? l : null;
};

// ─── Sample ─────────────────────────────────────────────────────────────────

interface Turn { id: string; session: string; index: number; content: string; question: string; audioUrl: string }
interface Session { id: string; lang: string; oral: string; global: string | null; saPron: number; turns: Turn[] }

async function loadSample(): Promise<Session[]> {
  const sb = getSupabaseServer();
  const { data, error } = await sb
    .from("sessions")
    .select("id, language, speechace_scores")
    .eq("source", "speechace")
    .eq("speechace_scores->reference->>calibration", "true")
    .order("id");
  if (error) throw error;

  const all = (data ?? [])
    .map((s) => {
      const sa = s.speechace_scores as SpeechaceScores;
      return { id: s.id as string, lang: s.language as string, oral: levelOf(sa.reference?.oral_level), global: levelOf(sa.reference?.global_level), saPron: sa.pronunciation };
    })
    .filter((s): s is { id: string; lang: string; oral: string; global: string | null; saPron: number } => s.oral !== null && typeof s.saPron === "number")
    .filter((s) => !LANGS || LANGS.includes(s.lang))
    .filter((s) => !SESSION_IDS || SESSION_IDS.some((p) => s.id.startsWith(p)));

  // PER_LEVEL per oral level, languages taken in turn so each level mixes them.
  const picked = SESSION_IDS
    ? all
    : LEVELS.flatMap((lvl) => {
        const byLang = new Map<string, typeof all>();
        for (const s of all.filter((x) => x.oral === lvl)) byLang.set(s.lang, [...(byLang.get(s.lang) ?? []), s]);
        const queues = [...byLang.values()];
        const out: typeof all = [];
        for (let i = 0; out.length < PER_LEVEL && queues.some((q) => q.length > i); i++) {
          for (const q of queues) if (q[i] && out.length < PER_LEVEL) out.push(q[i]);
        }
        return out;
      });

  const { data: turnRows, error: tErr } = await sb
    .from("session_turns")
    .select("id, session_id, turn_index, role, content, audio_url")
    .in("session_id", picked.map((s) => s.id))
    .order("turn_index");
  if (tErr) throw tErr;

  return picked
    .map((s) => {
      const rows = (turnRows ?? []).filter((t) => t.session_id === s.id);
      const turns: Turn[] = rows
        .filter((t) => t.role === "user" && t.audio_url && ((t.content as string) ?? "").trim().split(/\s+/).length >= 4)
        .slice(0, MAX_TURNS)
        .map((t) => ({
          id: t.id as string,
          session: s.id,
          index: t.turn_index as number,
          content: (t.content as string).trim(),
          question: ((rows.filter((x) => x.role === "assistant" && (x.turn_index as number) < (t.turn_index as number)).pop()?.content as string) ?? "").trim(),
          audioUrl: t.audio_url as string,
        }));
      return { ...s, turns };
    })
    .filter((s) => s.turns.length);
}

/** Latest stored score per turn for our own engines. */
async function storedScores(turnIds: string[]): Promise<Map<string, Map<string, number>>> {
  const sb = getSupabaseServer();
  const out = new Map<string, Map<string, number>>();
  const latest = new Map<string, string>();
  for (let i = 0; i < turnIds.length; i += 200) {
    const { data } = await sb
      .from("session_turn_evaluations")
      .select("turn_id, provider_id, result_json, created_at")
      .in("turn_id", turnIds.slice(i, i + 200))
      .in("provider_id", ["azure-ensemble", "voxtral"])
      .not("result_json", "is", null);
    for (const r of data ?? []) {
      const k = `${r.turn_id}|${r.provider_id}`;
      if ((latest.get(k) ?? "") > (r.created_at as string)) continue;
      const score = (r.result_json as { pronunciationScore?: number } | null)?.pronunciationScore;
      if (typeof score !== "number") continue;
      latest.set(k, r.created_at as string);
      const m = out.get(r.provider_id as string) ?? new Map<string, number>();
      m.set(r.turn_id as string, score);
      out.set(r.provider_id as string, m);
    }
  }
  return out;
}

async function downloadAudio(url: string): Promise<string> {
  const path = recordingPath(url);
  if (path) {
    const { data, error } = await getSupabaseServer().storage.from("recordings").download(path);
    if (error || !data) throw new Error(`recording ${path}: ${error?.message ?? "no data"}`);
    return Buffer.from(await data.arrayBuffer()).toString("base64");
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`recording ${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer()).toString("base64");
}

// ─── Run ────────────────────────────────────────────────────────────────────

interface Result {
  variant: string;
  model: string;
  prompt: PromptId;
  run: number;
  session: string;
  turn: string;
  score: number | null;
  ms: number;
  cost: number;
  overlap?: number;
  error?: string;
}

async function pool<T>(items: T[], limit: number, fn: (item: T, i: number) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; await fn(items[i], i); }
  }));
}

async function main() {
  if (LIST) {
    const ms = await audioModels();
    console.log(`${ms.length} audio-input models on OpenRouter:\n`);
    for (const m of ms.sort((a, b) => a.id.localeCompare(b.id))) {
      const p = m.pricing ?? {};
      console.log(`${m.id.padEnd(48)} prompt $${p.prompt ?? "?"}/tok  audio $${p.audio ?? p.input_audio ?? "?"}  completion $${p.completion ?? "?"}`);
    }
    console.log(`\nDefaults (newest per family): ${pickDefaults(ms).join(", ")}`);
    return;
  }

  const models = MODELS_ARG ?? pickDefaults(await audioModels());
  if (!models.length) throw new Error("no audio models resolved — try --list");
  const sessions = await loadSample();
  const turns = sessions.flatMap((s) => s.turns);
  const variants = models.flatMap((m) => PROMPTS.map((p) => ({ model: m, prompt: p, id: `${m.replace(/^[^/]+\//, "")} · ${p}` })));
  const jobs = turns.flatMap((t) => variants.flatMap((v) => Array.from({ length: RUNS }, (_, r) => ({ t, v, run: r + 1 }))));

  console.log(`Sample: ${sessions.length} sessions, ${turns.length} turns`);
  for (const s of sessions) console.log(`  ${s.id.slice(0, 8)} ${s.lang.padEnd(5)} oral ${s.oral}  global ${s.global ?? "—"}  Speechace pron ${s.saPron}  · ${s.turns.length} turns`);
  console.log(`Models: ${models.join(", ")}`);
  console.log(`Prompts: ${PROMPTS.join(", ")} · runs: ${RUNS} · calls: ${jobs.length} · retention: ${retentionLabel}`);
  if (DRY) return;
  requireKey();

  const stored = await storedScores(turns.map((t) => t.id));
  mkdirSync("analysis/reports", { recursive: true });
  const stamp = RESUME ? RESUME.match(/audio-judge-(.+)\.jsonl$/)?.[1] ?? new Date().toISOString().slice(0, 16).replace(":", "-") : new Date().toISOString().slice(0, 16).replace(":", "-");
  const jsonl = RESUME ?? `analysis/reports/audio-judge-${stamp}.jsonl`;

  // Resume: keep the previous run's calls for this sample, run only the missing ones.
  const key = (variant: string, turn: string, run: number) => `${variant}|${turn}|${run}`;
  const results: Result[] = [];
  if (RESUME) {
    const wanted = new Set(jobs.map((j) => key(j.v.id, j.t.id, j.run)));
    for (const line of readFileSync(RESUME, "utf8").split("\n")) {
      if (!line.trim()) continue;
      const r = JSON.parse(line) as Result;
      if (wanted.has(key(r.variant, r.turn, r.run))) results.push(r);
    }
  }
  const already = new Set(results.map((r) => key(r.variant, r.turn, r.run)));
  const todo = jobs.filter((j) => !already.has(key(j.v.id, j.t.id, j.run)));
  if (RESUME) console.log(`Resume: ${results.length} calls kept from ${RESUME}, ${todo.length} to run`);

  // Audio once per turn, kept in memory for every model.
  const audio = new Map<string, string>();
  const needAudio = turns.filter((t) => todo.some((j) => j.t.id === t.id));
  await pool(needAudio, 4, async (t) => { audio.set(t.id, await downloadAudio(t.audioUrl)); });

  let done = 0;
  const t0 = Date.now();
  await pool(todo, CONCURRENCY, async ({ t, v, run }) => {
    const lang = sessions.find((s) => s.id === t.session)!.lang;
    const call = await callModel(v.model, v.prompt === "listen" ? LISTEN_SYSTEM : TRANSCRIPT_SYSTEM, userText(v.prompt, lang, t.question, t.content), audio.get(t.id)!);
    const json = call.text ? parseJson(call.text) : null;
    const raw = json?.turn_score;
    const score = typeof raw === "number" && Number.isFinite(raw) ? Math.max(0, Math.min(100, Math.round(raw))) : null;
    const res: Result = {
      variant: v.id, model: v.model, prompt: v.prompt, run, session: t.session, turn: t.id, score,
      ms: call.ms, cost: call.cost,
      error: call.error ?? (score === null ? `unparsable: ${(call.text ?? "").slice(0, 120)}` : undefined),
    };
    if (v.prompt === "listen" && typeof json?.transcript === "string") res.overlap = Math.round(overlap(t.content, json.transcript) * 100) / 100;
    results.push(res);
    appendFileSync(jsonl, JSON.stringify(res) + "\n");
    done++;
    console.log(`[${done}/${todo.length}] ${v.id.padEnd(40)} r${run} ${t.session.slice(0, 8)}#${t.index}: ${score ?? "fail"} (${(call.ms / 1000).toFixed(1)}s${res.error ? ` — ${res.error.slice(0, 80)}` : ""})`);
  });

  writeReport(sessions, stored, variants, results, stamp, (Date.now() - t0) / 1000);
}

// ─── Report ─────────────────────────────────────────────────────────────────

function writeReport(
  sessions: Session[],
  stored: Map<string, Map<string, number>>,
  variants: Array<{ id: string; model: string; prompt: PromptId }>,
  results: Result[],
  stamp: string,
  seconds: number,
) {
  // Per variant: turn → score (run 1 for session means; runs 1 vs 2 for noise).
  type Rows = { id: string; byTurn: (turnId: string, run?: number) => number | null; calls: Result[] };
  const rows: Rows[] = [
    ...["azure-ensemble", "voxtral"].map((p) => ({
      id: p === "azure-ensemble" ? "azure-ensemble (live, stored)" : "voxtral-small (stored)",
      byTurn: (turnId: string, run = 1) => (run === 1 ? stored.get(p)?.get(turnId) ?? null : null),
      calls: [] as Result[],
    })),
    ...variants.map((v) => {
      const calls = results.filter((r) => r.variant === v.id);
      return { id: v.id, byTurn: (turnId: string, run = 1) => calls.find((r) => r.turn === turnId && r.run === run)?.score ?? null, calls };
    }),
  ];

  const sessionScore = (row: Rows, s: Session) => mean(s.turns.map((t) => row.byTurn(t.id)).filter((x): x is number => x !== null));
  const lvl = (l: string) => LEVELS.indexOf(l);

  const out: string[] = [
    `# Audio-model pronunciation replay — ${stamp.replace("T", " ")}\n`,
    `${sessions.length} calibration sessions (${[...new Set(sessions.map((s) => s.lang))].join(", ")}), ${sessions.reduce((a, s) => a + s.turns.length, 0)} turns · runs per variant: ${RUNS} · ${Math.round(seconds / 60)} min · retention: ${retentionLabel}\n`,
    "Speechace's pronunciation score is per session, so every comparison is on session means (run 1). ρ = rank correlation (1 = same order). Gap = mean of C1–C2 sessions minus A1–A2 (oral level). Noise = mean |run 1 − run 2| per turn. Invented = listen-prompt turns whose transcript shares under half its words with the stored one.",
    `With ${sessions.length} sessions, correlations within about ±0.3 of each other are not a real difference.\n`,
    "## Summary\n",
    "| Variant | Sessions | Mean | Bias vs Speechace | r Speechace | ρ Speechace | ρ oral level | ρ global level | Gap C − A | Noise | Failures | Invented | p50 s | $ total |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
  ];

  const saMeanBy = (pick: (s: Session) => boolean) => mean(sessions.filter(pick).map((s) => s.saPron));
  {
    const xs = sessions.map((s) => s.saPron);
    const gap = saMeanBy((s) => s.oral.startsWith("C")) - saMeanBy((s) => s.oral.startsWith("A"));
    const g = sessions.filter((s) => s.global);
    out.push(`| *Speechace (reference)* | ${sessions.length} | ${r1(mean(xs))} | — | — | — | ${r2(spearman(xs, sessions.map((s) => lvl(s.oral))))} | ${r2(spearman(g.map((s) => s.saPron), g.map((s) => lvl(s.global!))))} | ${r1(gap)} | — | — | — | — | — |`);
  }

  for (const row of rows) {
    const scored = sessions.map((s) => ({ s, v: sessionScore(row, s) })).filter((x) => Number.isFinite(x.v));
    const ours = scored.map((x) => x.v), sa = scored.map((x) => x.s.saPron);
    const g = scored.filter((x) => x.s.global);
    const by = (pick: (s: Session) => boolean) => mean(scored.filter((x) => pick(x.s)).map((x) => x.v));
    const noise: number[] = [];
    for (const s of sessions) for (const t of s.turns) {
      const a = row.byTurn(t.id, 1), b = row.byTurn(t.id, 2);
      if (a !== null && b !== null) noise.push(Math.abs(a - b));
    }
    const listen = row.calls.filter((c) => c.prompt === "listen" && c.overlap !== undefined);
    const invented = listen.filter((c) => (c.overlap ?? 1) < INVENTED_BELOW).length;
    const failed = row.calls.filter((c) => c.score === null).length;
    out.push(
      `| ${row.id} | ${scored.length} | ${r1(mean(ours))} | ${r1(mean(ours.map((v, i) => v - sa[i])))} | ${r2(pearson(ours, sa))} | ${r2(spearman(ours, sa))} | ${r2(spearman(ours, scored.map((x) => lvl(x.s.oral))))} | ${r2(spearman(g.map((x) => x.v), g.map((x) => lvl(x.s.global!))))} | ${r1(by((s) => s.oral.startsWith("C")) - by((s) => s.oral.startsWith("A")))} | ${noise.length ? r1(mean(noise)) : "—"} | ${row.calls.length ? `${failed}/${row.calls.length}` : "—"} | ${listen.length ? `${invented}/${listen.length}` : "—"} | ${row.calls.length ? r1(median(row.calls.map((c) => c.ms / 1000))) : "—"} | ${row.calls.length ? row.calls.reduce((a, c) => a + c.cost, 0).toFixed(2) : "—"} |`,
    );
  }

  out.push("\n## Mean session score by oral reference level\n", `| Variant | ${LEVELS.join(" | ")} |`, `|---|${LEVELS.map(() => "---").join("|")}|`);
  out.push(`| *Speechace* | ${LEVELS.map((l) => r1(saMeanBy((s) => s.oral === l))).join(" | ")} |`);
  for (const row of rows) out.push(`| ${row.id} | ${LEVELS.map((l) => r1(mean(sessions.filter((s) => s.oral === l).map((s) => sessionScore(row, s)).filter(Number.isFinite)))).join(" | ")} |`);
  out.push(`| *n sessions* | ${LEVELS.map((l) => sessions.filter((s) => s.oral === l).length).join(" | ")} |`);

  out.push("\n## Sessions\n", `| session | lang | oral | global | Speechace | ${rows.map((r) => r.id).join(" | ")} |`, `|---|---|---|---|---|${rows.map(() => "---").join("|")}|`);
  for (const s of sessions) out.push(`| ${s.id.slice(0, 8)} | ${s.lang} | ${s.oral} | ${s.global ?? "—"} | ${s.saPron} | ${rows.map((r) => r1(sessionScore(r, s))).join(" | ")} |`);

  const errors = results.filter((r) => r.error);
  if (errors.length) {
    out.push("\n## Failures (first per variant)\n");
    for (const v of variants) {
      const e = errors.find((r) => r.variant === v.id);
      if (e) out.push(`- **${v.id}** (${errors.filter((r) => r.variant === v.id).length}): ${e.error}`);
    }
  }

  const file = `analysis/reports/audio-judge-${stamp}.md`;
  writeFileSync(file, out.join("\n") + "\n");
  console.log("\n" + out.slice(0, out.indexOf("\n## Sessions\n")).join("\n"));
  console.log(`\nWritten ${file} (every call: analysis/reports/audio-judge-${stamp}.jsonl)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
