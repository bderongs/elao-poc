/**
 * Which text judge scores pronunciation RIGHT — measured against the
 * calibration references (Speechace, ELAO's oral and global levels), not
 * against another model? And what does Azure's acoustic evidence actually
 * change in the score?
 *
 * Same sample as scripts/audio-judge-replay.ts (Speechace calibration
 * sessions, 2 per oral level, the first 5 turns of ≥ 4 words), so the numbers
 * line up with the audio models measured there.
 *
 * Baseline — no call: "prod-db" is the azure-ensemble result already stored
 * for each turn (session_turn_evaluations, eval lab: Azure + 2512 judge, as in
 * production at the time it ran). The report also gives that baseline on the
 * WHOLE calibration set, and the dates the stored results were produced.
 *
 * Judge variants, same JUDGE_SYSTEM and same evidence per turn, scored with
 * the production scoreFromVerdict (word-verdict cap, jokers):
 *   - 2512-noaz    mistral-large-2512 without Azure ("ACOUSTIC scores: unavailable")   default
 *   - small-noaz   mistral-small-latest (Small 4) without Azure                          default
 *   - small        Small 4 with Azure            — needs Azure (--with-azure adds it)
 *   - 2512         2512 with fresh Azure         — needs Azure (prod-db is usually enough)
 *
 * Evidence is cached per turn in sim-runs/judge-evidence-cache.jsonl (Voxtral
 * transcription + Azure acoustic): a rerun never repeats a successful call.
 * Azure calls run one at a time (the key may be a free F0 resource shared
 * with production); when Azure fails, the Azure variants of that turn stay
 * missing and --resume fills them later — the no-Azure variants still run.
 *
 *   npx tsx scripts/judge-calibration-replay.ts
 *   npx tsx scripts/judge-calibration-replay.ts --with-azure --resume sim-runs/judge-calibration-<ts>.jsonl
 *   npx tsx scripts/judge-calibration-replay.ts --variants 2512-noaz,small-noaz,small --per-level 3
 *
 * mistral-large-2512 is capped at 15 requests/minute on the account, shared
 * with production: --rpm-2512 (default 6). Read-only on the database.
 * Writes sim-runs/judge-calibration-<ts>.md.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
for (const f of [".env", ".env.local"]) if (existsSync(f)) process.loadEnvFile(f);

import { getSupabaseServer } from "../lib/supabase-server";
import { recordingPath } from "../lib/recordings";
import { contentText, requireApiKey } from "../lib/mistral";
import { verbatimHearing } from "../lib/pronunciation/verbatim";
import {
  azureAcoustic,
  buildJudgeEvidence,
  JUDGE_SYSTEM,
  LANG_LABELS,
  parseJudgeReply,
  scoreFromVerdict,
  type JudgeResult,
} from "../lib/pronunciation/providers/azure-ensemble";
import type { SpeechaceScores } from "../lib/types";

const args = process.argv.slice(2);
const opt = (name: string, def?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const PER_LEVEL = Number(opt("per-level", "2"));
const MAX_TURNS = Number(opt("max-turns", "5"));
const RPM_2512 = Number(opt("rpm-2512", "6"));
const SESSION_IDS = opt("sessions")?.split(",");
/** A previous run's .jsonl: its turns are kept, only the missing ones run (appended to it). */
const RESUME = opt("resume");
const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];

// ─── Judge variants ─────────────────────────────────────────────────────────

interface Variant { id: string; label: string; model: string; noAzure?: boolean; rpm: number }
const ALL_VARIANTS: Variant[] = [
  { id: "2512-noaz", label: "mistral-large-2512, without Azure", model: "mistral-large-2512", noAzure: true, rpm: RPM_2512 },
  { id: "small-noaz", label: "Small 4, without Azure", model: "mistral-small-latest", noAzure: true, rpm: 60 },
  { id: "small", label: "Small 4, with Azure", model: "mistral-small-latest", rpm: 60 },
  { id: "2512", label: "mistral-large-2512, with fresh Azure", model: "mistral-large-2512", rpm: RPM_2512 },
];
const VARIANT_IDS = opt("variants")?.split(",") ?? ["2512-noaz", "small-noaz", ...(args.includes("--with-azure") ? ["small"] : [])];
const VARIANTS = ALL_VARIANTS.filter((v) => VARIANT_IDS.includes(v.id));
const NEEDS_AZURE = VARIANTS.some((v) => !v.noAzure);
/** The stored production result — read from the database, not a judge call. */
const PROD_DB = { id: "prod-db", label: "Production as stored (Azure + 2512, eval lab)" };

// One gate per model (2512 and 2512-noaz share it): calls start 60/rpm s apart.
const gates = new Map<string, Promise<void>>();
function throttle(v: Variant): Promise<void> {
  const prev = gates.get(v.model) ?? Promise.resolve();
  gates.set(v.model, prev.then(() => new Promise<void>((r) => setTimeout(r, 60_000 / v.rpm))));
  return prev;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function judge(v: Variant, evidence: string): Promise<JudgeResult | null> {
  for (let attempt = 0; attempt < 6; attempt++) {
    await throttle(v);
    try {
      const res = await fetch("https://api.mistral.ai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${requireApiKey()}`, "Content-Type": "application/json" },
        // Production's call: max_tokens 2000, JSON mode (azure-ensemble.ts judge()).
        body: JSON.stringify({ model: v.model, messages: [{ role: "system", content: JUDGE_SYSTEM }, { role: "user", content: evidence }], max_tokens: 2000, response_format: { type: "json_object" } }),
        signal: AbortSignal.timeout(120_000),
      });
      if (res.status === 429 || res.status >= 500) { await sleep(30_000); continue; }
      if (!res.ok) return null;
      const data = (await res.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
      const text = contentText(data.choices?.[0]?.message?.content);
      return text ? parseJudgeReply(text) : null;
    } catch {
      await sleep(10_000);
    }
  }
  return null;
}

// ─── Sample (same picking as scripts/audio-judge-replay.ts) ─────────────────

const levelOf = (s: string | null | undefined) => {
  const l = (s ?? "").replace(/\s*\(.*\)|\.\d+/g, "").replace("+", "").trim().toUpperCase();
  return LEVELS.includes(l) ? l : null;
};

interface Turn { id: string; index: number; content: string; question: string; audioUrl: string }
interface Session { id: string; lang: string; oral: string; global: string | null; saPron: number; turns: Turn[] }
type CalibSession = Omit<Session, "turns">;

async function loadSample(): Promise<{ sample: Session[]; calibration: CalibSession[] }> {
  const sb = getSupabaseServer();
  const { data, error } = await sb.from("sessions").select("id, language, speechace_scores").eq("source", "speechace")
    .eq("speechace_scores->reference->>calibration", "true").order("id");
  if (error) throw error;
  const all = (data ?? [])
    .map((s) => {
      const sa = s.speechace_scores as SpeechaceScores;
      return { id: s.id as string, lang: s.language as string, oral: levelOf(sa.reference?.oral_level), global: levelOf(sa.reference?.global_level), saPron: sa.pronunciation };
    })
    .filter((s): s is { id: string; lang: string; oral: string; global: string | null; saPron: number } => s.oral !== null && typeof s.saPron === "number")
    .filter((s) => !SESSION_IDS || SESSION_IDS.some((p) => s.id.startsWith(p)));
  const picked = SESSION_IDS ? all : LEVELS.flatMap((lvl) => {
    const byLang = new Map<string, typeof all>();
    for (const s of all.filter((x) => x.oral === lvl)) byLang.set(s.lang, [...(byLang.get(s.lang) ?? []), s]);
    const queues = [...byLang.values()];
    const out: typeof all = [];
    for (let i = 0; out.length < PER_LEVEL && queues.some((q) => q.length > i); i++) for (const q of queues) if (q[i] && out.length < PER_LEVEL) out.push(q[i]);
    return out;
  });
  const { data: rows, error: tErr } = await sb.from("session_turns").select("id, session_id, turn_index, role, content, audio_url")
    .in("session_id", picked.map((s) => s.id)).order("turn_index");
  if (tErr) throw tErr;
  const sample = picked.map((s) => {
    const mine = (rows ?? []).filter((t) => t.session_id === s.id);
    const turns = mine
      .filter((t) => t.role === "user" && t.audio_url && ((t.content as string) ?? "").trim().split(/\s+/).length >= 4)
      .slice(0, MAX_TURNS)
      .map((t) => ({
        id: t.id as string, index: t.turn_index as number, content: (t.content as string).trim(), audioUrl: t.audio_url as string,
        question: ((mine.filter((x) => x.role === "assistant" && (x.turn_index as number) < (t.turn_index as number)).pop()?.content as string) ?? "").trim(),
      }));
    return { ...s, turns };
  }).filter((s) => s.turns.length);
  return { sample, calibration: all };
}

/** Latest successful azure-ensemble result per turn (eval lab), for the given sessions — score, verdicts, date. */
interface Stored { score: number; verdicts: string[]; at: string }
async function loadStored(sessionIds: string[]): Promise<Map<string, Stored & { session: string }>> {
  const sb = getSupabaseServer();
  const turnSession = new Map<string, string>();
  for (let i = 0; i < sessionIds.length; i += 100) {
    const { data, error } = await sb.from("session_turns").select("id, session_id").eq("role", "user").in("session_id", sessionIds.slice(i, i + 100));
    if (error) throw error;
    for (const t of data ?? []) turnSession.set(t.id as string, t.session_id as string);
  }
  const ids = [...turnSession.keys()];
  const out = new Map<string, Stored & { session: string }>();
  // azure-ensemble word scores are the judge verdicts mapped (VERDICT_MAP); anything else = a forgiven word or the Azure fallback.
  const verdictOf = (x: number) => ({ 96: "good", 72: "ok", 42: "off", 16: "bad" })[x] ?? "other";
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await sb.from("session_turn_evaluations").select("turn_id, result_json, created_at")
      .eq("provider_id", "azure-ensemble").is("error", null).in("turn_id", ids.slice(i, i + 200)).order("created_at");
    if (error) throw error;
    for (const r of data ?? []) {
      const res = r.result_json as { pronunciationScore?: number; words?: Array<{ accuracyScore: number }> } | null;
      if (typeof res?.pronunciationScore !== "number") continue;
      // ordered by date: the last write per turn wins.
      out.set(r.turn_id as string, { session: turnSession.get(r.turn_id as string)!, score: res.pronunciationScore, verdicts: (res.words ?? []).map((w) => verdictOf(w.accuracyScore)), at: r.created_at as string });
    }
  }
  return out;
}

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

// ─── Run ────────────────────────────────────────────────────────────────────

interface TurnResult { session: string; turn: string; scores: Record<string, number | null>; verdicts: Record<string, string[]>; azureAvg: number | null }

type Az = Awaited<ReturnType<typeof azureAcoustic>>;
type Dg = Awaited<ReturnType<typeof verbatimHearing>>;
const CACHE = "sim-runs/judge-evidence-cache.jsonl";

async function main() {
  const azKey = process.env.AZURE_SPEECH_KEY;
  const azRegion = process.env.AZURE_SPEECH_REGION ?? "westeurope";
  if (NEEDS_AZURE && !azKey) throw new Error("AZURE_SPEECH_KEY missing");
  const { sample: sessions, calibration } = await loadSample();
  const turns = sessions.flatMap((s) => s.turns.map((t) => ({ s, t })));
  console.log(`Sample: ${sessions.length} sessions, ${turns.length} turns · variants: ${VARIANTS.map((v) => v.id).join(", ")} · Azure: ${NEEDS_AZURE ? "yes (one call at a time, cached)" : "no call"}`);
  for (const s of sessions) console.log(`  ${s.id.slice(0, 8)} ${s.lang.padEnd(5)} oral ${s.oral}  global ${s.global ?? "—"}  Speechace pron ${s.saPron}  · ${s.turns.length} turns`);

  const sb = getSupabaseServer();
  mkdirSync("sim-runs", { recursive: true });

  // Stored production results — whole calibration set (for the baseline section), the sample's turns among them.
  const stored = await loadStored(calibration.map((s) => s.id));

  const jsonl = RESUME ?? `sim-runs/judge-calibration-${new Date().toISOString().slice(0, 16).replace(":", "-")}.jsonl`;
  const results = new Map<string, TurnResult>();
  if (RESUME) {
    for (const line of readFileSync(RESUME, "utf8").split("\n")) {
      if (!line.trim()) continue;
      const r = JSON.parse(line) as TurnResult;
      // Later lines complete earlier ones (a resumed turn appends its newly filled variants).
      const prev = results.get(r.turn);
      results.set(r.turn, prev ? { ...prev, scores: { ...prev.scores, ...r.scores }, verdicts: { ...prev.verdicts, ...r.verdicts }, azureAvg: r.azureAvg ?? prev.azureAvg } : r);
    }
  }
  const missing = (turnId: string) => VARIANTS.filter((v) => typeof results.get(turnId)?.scores[v.id] !== "number");
  const todo = turns.filter(({ t }) => missing(t.id).length);
  if (RESUME) console.log(`Resume: ${turns.length - todo.length} turns complete in ${RESUME}, ${todo.length} to run or complete`);

  // Evidence cache: one line per turn and kind; a successful call is never repeated.
  const cache = new Map<string, { dg?: Dg; az?: Az }>();
  if (existsSync(CACHE)) for (const line of readFileSync(CACHE, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const c = JSON.parse(line) as { turn: string; dg?: Dg; az?: Az };
    cache.set(c.turn, { ...cache.get(c.turn), ...(c.dg ? { dg: c.dg } : {}), ...(c.az ? { az: c.az } : {}) });
  }
  const remember = (turn: string, part: { dg?: Dg; az?: Az }) => {
    cache.set(turn, { ...cache.get(turn), ...part });
    appendFileSync(CACHE, JSON.stringify({ turn, ...part }) + "\n");
  };

  // Network hiccups (Supabase storage) must cost a retry, not a silent gap in the sample.
  const download = async (url: string): Promise<ArrayBuffer> => {
    for (let attempt = 0; ; attempt++) {
      try {
        const path = recordingPath(url);
        const blob = path ? (await sb.storage.from("recordings").download(path)).data : await fetch(url).then((r) => (r.ok ? r.blob() : null));
        if (blob) return await blob.arrayBuffer();
        throw new Error("no data");
      } catch (e) {
        if (attempt >= 3) throw new Error(`recording download failed: ${String(e)}`);
        await sleep(5000 * (attempt + 1));
      }
    }
  };

  // Azure: one call at a time, 2 s apart; after 3 failed turns in a row (quota), stop calling it for this run.
  let azChain: Promise<unknown> = Promise.resolve();
  let azFailStreak = 0;
  const azureOnce = (audio: ArrayBuffer, ct: string, lang: string): Promise<Az> => {
    const p = azChain.then(async () => {
      if (azFailStreak >= 3) return null;
      for (let attempt = 0; attempt < 2; attempt++) {
        const az = await azureAcoustic(audio, ct, lang, azKey!, azRegion).catch(() => null);
        await sleep(2000);
        if (az) { azFailStreak = 0; return az; }
      }
      if (++azFailStreak === 3) console.warn("[azure] 3 turns failed in a row — no more Azure calls this run (quota?). --resume later fills the Azure variants.");
      return null;
    });
    azChain = p;
    return p;
  };

  let done = 0;
  let next = 0;
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (next < todo.length) {
      const { s, t } = todo[next++];
      try {
        const want = missing(t.id);
        const cached = cache.get(t.id) ?? {};
        const ct = "audio/wav; codecs=audio/pcm; samplerate=16000";
        const needAz = want.some((v) => !v.noAzure) && !cached.az;
        let audio: ArrayBuffer | null = null;
        if (!cached.dg || needAz) audio = await download(t.audioUrl);
        const dg = cached.dg ?? (await verbatimHearing(audio!, ct, s.lang));
        if (!cached.dg && dg) remember(t.id, { dg });
        let az = cached.az ?? null;
        if (needAz) { az = await azureOnce(audio!, ct, s.lang); if (az) remember(t.id, { az }); }

        const runnable = want.filter((v) => v.noAzure || az);
        const liveWords = t.content.split(/\s+/).filter(Boolean);
        const langLabel = LANG_LABELS[s.lang] ?? "English";
        const verdicts = await Promise.all(runnable.map((v) => judge(v, buildJudgeEvidence(t.content, langLabel, t.question, dg, v.noAzure ? null : az))));
        const r: TurnResult = { session: s.id, turn: t.id, scores: {}, verdicts: {}, azureAvg: az?.words.length ? mean(az.words.map((w) => w.accuracyScore)) : null };
        runnable.forEach((v, i) => {
          const verdict = verdicts[i];
          if (!verdict) return; // a failed judge call stays missing — --resume retries it
          r.scores[v.id] = scoreFromVerdict(liveWords, verdict).score;
          r.verdicts[v.id] = liveWords.map((_, k) => verdict.words[k]?.v ?? "ok");
        });
        appendFileSync(jsonl, JSON.stringify(r) + "\n");
        const prev = results.get(t.id);
        results.set(t.id, prev ? { ...prev, scores: { ...prev.scores, ...r.scores }, verdicts: { ...prev.verdicts, ...r.verdicts }, azureAvg: r.azureAvg ?? prev.azureAvg } : r);
        const merged = results.get(t.id)!;
        console.log(`[${++done}/${todo.length}] ${s.oral} ${s.lang} ${s.id.slice(0, 8)}#${t.index} prod ${stored.get(t.id)?.score ?? "—"} azure ${r1(merged.azureAvg ?? NaN)} ${VARIANTS.map((v) => `${v.id}=${merged.scores[v.id] ?? "missing"}`).join(" ")}`);
      } catch (e) {
        console.warn(`[skip] ${s.id.slice(0, 8)}#${t.index}: ${String(e)}`);
      }
    }
  }));

  // The stored production result joins each sampled turn as the "prod-db" column.
  for (const { s, t } of turns) {
    const st = stored.get(t.id);
    if (!st) continue;
    const r = results.get(t.id) ?? { session: s.id, turn: t.id, scores: {}, verdicts: {}, azureAvg: null };
    r.scores[PROD_DB.id] = st.score;
    r.verdicts[PROD_DB.id] = st.verdicts;
    results.set(t.id, r);
  }
  report(sessions, [...results.values()].filter((r) => turns.some(({ t }) => t.id === r.turn)), calibration, stored, jsonl);
}

// ─── Report ─────────────────────────────────────────────────────────────────

function report(sessions: Session[], results: TurnResult[], calibration: CalibSession[], stored: Map<string, Stored & { session: string }>, jsonl: string) {
  const lvl = (l: string) => LEVELS.indexOf(l);
  type Row = { id: string; label: string; score: (s: Session) => number };
  const sessionMean = (s: Session, pick: (r: TurnResult) => number | null) =>
    mean(results.filter((r) => r.session === s.id).map(pick).filter((x): x is number => typeof x === "number"));
  const judges = [PROD_DB, ...VARIANTS];
  const rows: Row[] = [
    ...judges.map((v) => ({ id: v.id, label: v.label, score: (s: Session) => sessionMean(s, (r) => r.scores[v.id]) })),
    ...(results.some((r) => r.azureAvg !== null) ? [{ id: "azure", label: "Azure acoustic alone (word mean)", score: (s: Session) => sessionMean(s, (r) => r.azureAvg) }] : []),
  ];

  const out: string[] = [
    `# Pronunciation judge vs calibration references — ${new Date().toISOString().slice(0, 16)}\n`,
    `${sessions.length} Speechace calibration sessions (${[...new Set(sessions.map((s) => s.lang))].join(", ")}), ${results.length} turns. "${PROD_DB.label}" = the azure-ensemble result already in session_turn_evaluations (no new call). The judge variants get the same evidence per turn (Voxtral transcription, plus Azure acoustic for the \"with Azure\" ones); production scoring (scoreFromVerdict). Session score = mean of its turns. Raw results: ${jsonl}.\n`,
    "ρ = rank correlation (1 = same order). Gap = mean of C1–C2 sessions minus A1–A2 (oral level). The oral reference level is ELAO's, derived from Speechace; the global level also covers ELAO's other tests.",
    `With ${sessions.length} sessions, correlations within about ±0.3 of each other are not a real difference.\n`,
    "## Summary\n",
    "| Judge | Mean | Bias vs Speechace | r Speechace | ρ Speechace | ρ oral level | ρ global level | Gap C − A | A1 mean | Missing turns |",
    "|---|---|---|---|---|---|---|---|---|---|",
  ];
  const saBy = (pick: (s: Session) => boolean) => mean(sessions.filter(pick).map((s) => s.saPron));
  {
    const xs = sessions.map((s) => s.saPron);
    const g = sessions.filter((s) => s.global);
    out.push(`| *Speechace (reference)* | ${r1(mean(xs))} | — | — | — | ${r2(spearman(xs, sessions.map((s) => lvl(s.oral))))} | ${r2(spearman(g.map((s) => s.saPron), g.map((s) => lvl(s.global!))))} | ${r1(saBy((s) => s.oral.startsWith("C")) - saBy((s) => s.oral.startsWith("A")))} | ${r1(saBy((s) => s.oral === "A1"))} | — |`);
  }
  for (const row of rows) {
    const sc = sessions.map((s) => ({ s, v: row.score(s) })).filter((x) => Number.isFinite(x.v));
    const ours = sc.map((x) => x.v), sa = sc.map((x) => x.s.saPron);
    const g = sc.filter((x) => x.s.global);
    const by = (pick: (s: Session) => boolean) => mean(sc.filter((x) => pick(x.s)).map((x) => x.v));
    const failed = judges.some((v) => v.id === row.id) ? results.filter((r) => typeof r.scores[row.id] !== "number").length : 0;
    out.push(`| ${row.label} | ${r1(mean(ours))} | ${r1(mean(ours.map((v, i) => v - sa[i])))} | ${r2(pearson(ours, sa))} | ${r2(spearman(ours, sa))} | ${r2(spearman(ours, sc.map((x) => lvl(x.s.oral))))} | ${r2(spearman(g.map((x) => x.v), g.map((x) => lvl(x.s.global!))))} | ${r1(by((s) => s.oral.startsWith("C")) - by((s) => s.oral.startsWith("A")))} | ${r1(by((s) => s.oral === "A1"))} | ${failed}/${results.length} |`);
  }

  out.push("\n## Mean session score by oral reference level\n", `| Judge | ${LEVELS.join(" | ")} |`, `|---|${LEVELS.map(() => "---").join("|")}|`);
  out.push(`| *Speechace* | ${LEVELS.map((l) => r1(saBy((s) => s.oral === l))).join(" | ")} |`);
  for (const row of rows) out.push(`| ${row.label} | ${LEVELS.map((l) => r1(mean(sessions.filter((s) => s.oral === l).map(row.score).filter(Number.isFinite)))).join(" | ")} |`);

  // Verdict mix per oral level — share of good / ok / off / bad words.
  out.push("\n## Word verdicts by oral level (good / ok / off / bad, % of words)\n", `| Judge | ${LEVELS.join(" | ")} |`, `|---|${LEVELS.map(() => "---").join("|")}|`);
  for (const v of judges) {
    const cells = LEVELS.map((l) => {
      const ids = new Set(sessions.filter((s) => s.oral === l).map((s) => s.id));
      const all = results.filter((r) => ids.has(r.session)).flatMap((r) => r.verdicts[v.id] ?? []);
      if (!all.length) return "—";
      const p = (k: string) => Math.round((100 * all.filter((x) => x === k).length) / all.length);
      return `${p("good")} / ${p("ok")} / ${p("off")} / ${p("bad")}${v.id === PROD_DB.id ? ` (+${p("other")} forgiven/fallback)` : ""}`;
    });
    out.push(`| ${v.label} | ${cells.join(" | ")} |`);
  }

  // Production as stored, on the WHOLE calibration set — no sampling, no call.
  {
    const per = calibration.map((s) => ({ s, xs: [...stored.values()].filter((x) => x.session === s.id) })).filter((x) => x.xs.length);
    const sc = per.map(({ s, xs }) => ({ s, v: mean(xs.map((x) => x.score)) }));
    const ours = sc.map((x) => x.v), sa = sc.map((x) => x.s.saPron);
    const g = sc.filter((x) => x.s.global);
    const by = (pick: (s: CalibSession) => boolean) => mean(sc.filter((x) => pick(x.s)).map((x) => x.v));
    const dates = [...stored.values()].map((x) => x.at.slice(0, 10)).sort();
    const months = new Map<string, number>();
    for (const d of dates) months.set(d.slice(0, 7), (months.get(d.slice(0, 7)) ?? 0) + 1);
    out.push(
      `\n## Production as stored — whole calibration set (${sc.length} sessions, ${dates.length} turns)\n`,
      `All the user turns that have a stored azure-ensemble result. Results produced ${dates[0]} → ${dates.at(-1)}, by month: ${[...months].map(([m, n]) => `${m} ${n}`).join(", ")} — older ones may predate the current prompt or transcription engine.\n`,
      "| | Mean | Bias vs Speechace | r Speechace | ρ Speechace | ρ oral level | ρ global level | Gap C − A | A1 mean |",
      "|---|---|---|---|---|---|---|---|---|",
      `| Speechace | ${r1(mean(sa))} | — | — | — | ${r2(spearman(sa, sc.map((x) => lvl(x.s.oral))))} | ${r2(spearman(g.map((x) => x.s.saPron), g.map((x) => lvl(x.s.global!))))} | ${r1(mean(sc.filter((x) => x.s.oral.startsWith("C")).map((x) => x.s.saPron)) - mean(sc.filter((x) => x.s.oral.startsWith("A")).map((x) => x.s.saPron)))} | ${r1(mean(sc.filter((x) => x.s.oral === "A1").map((x) => x.s.saPron)))} |`,
      `| Production as stored | ${r1(mean(ours))} | ${r1(mean(ours.map((v, i) => v - sa[i])))} | ${r2(pearson(ours, sa))} | ${r2(spearman(ours, sa))} | ${r2(spearman(ours, sc.map((x) => lvl(x.s.oral))))} | ${r2(spearman(g.map((x) => x.v), g.map((x) => lvl(x.s.global!))))} | ${r1(by((s) => s.oral.startsWith("C")) - by((s) => s.oral.startsWith("A")))} | ${r1(by((s) => s.oral === "A1"))} |`,
      `\nBy oral level (sessions): ${LEVELS.map((l) => `${l} ${r1(by((s) => s.oral === l))} vs Speechace ${r1(mean(sc.filter((x) => x.s.oral === l).map((x) => x.s.saPron)))} (n=${sc.filter((x) => x.s.oral === l).length})`).join(" · ")}`,
    );
  }

  out.push("\n## Sessions\n", `| session | lang | oral | global | Speechace | ${rows.map((r) => r.id).join(" | ")} |`, `|---|---|---|---|---|${rows.map(() => "---").join("|")}|`);
  for (const s of sessions) out.push(`| ${s.id.slice(0, 8)} | ${s.lang} | ${s.oral} | ${s.global ?? "—"} | ${s.saPron} | ${rows.map((r) => r1(r.score(s))).join(" | ")} |`);

  mkdirSync("sim-runs", { recursive: true });
  const file = `sim-runs/judge-calibration-${new Date().toISOString().slice(0, 16).replace(":", "-")}.md`;
  writeFileSync(file, out.join("\n") + "\n");
  console.log("\n" + out.slice(0, out.indexOf("\n## Sessions\n")).join("\n"));
  console.log(`\nWritten ${file}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
