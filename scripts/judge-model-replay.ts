/**
 * Does moving the two large-model calls from mistral-large-2512 to Mistral
 * Large 4 (mistral-large-latest, reasoning_effort "low") change scores?
 *
 * The two calls on MISTRAL_MODEL / MISTRAL_PRONUNCIATION_MODEL:
 *   - the pronunciation judge (lib/pronunciation/providers/azure-ensemble.ts)
 *   - the end-of-session CEFR evaluation (app/api/evaluate/route.ts)
 *
 * Each turn's evidence (Voxtral transcription + Azure acoustic) is gathered
 * ONCE, then the same judge message goes to every model, so score gaps come
 * from the model alone. The CEFR evaluation gets the session's stored
 * transcript and pronunciation averages. mistral-large-2512 runs twice: the
 * gap between its two runs is the model's own run-to-run noise, the
 * yardstick for reading the 2512 → Large 4 gap. Also records latency,
 * tokens (reasoning included) and failures.
 *
 * mistral-large-2512 is capped at 15 requests/minute on the account, and
 * production shares that quota: --rpm-2512 (default 6) keeps the rest free.
 *
 *   npx tsx scripts/judge-model-replay.ts                    # 2 sessions per language
 *   npx tsx scripts/judge-model-replay.ts --per-lang 1 --lang fr,en --max-turns 4
 *   npx tsx scripts/judge-model-replay.ts --effort medium --no-noise
 *   npx tsx scripts/judge-model-replay.ts --candidate small        # mistral-small-latest instead of Large 4
 *   npx tsx scripts/judge-model-replay.ts --candidate glm-flash    # zai-glm-5-3-flash (reasoning_effort from --effort)
 *
 * Writes sim-runs/judge-model-replay-<timestamp>.md. Read-only on the database.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
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
import { CEFR_SYSTEM_PROMPT, buildEvaluationUserMessage, parseCefrEvaluation, withAnswerEvidence, withC2Evidence } from "../lib/cefr-prompt";
import { computeCompositeCefrScore } from "../lib/cefr-score";
import type { ConvLang } from "../lib/conversation-prompts";
import type { PronunciationAvg } from "../lib/types";

const args = process.argv.slice(2);
const opt = (name: string, def?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const PER_LANG = Number(opt("per-lang", "2"));
const LANGS = (opt("lang", "fr,en,nl-BE,es,it,de") as string).split(",");
const SINCE = opt("since", "2026-09-30");
const MAX_TURNS = Number(opt("max-turns", "6"));
const EFFORT = opt("effort", "low") as "low" | "medium" | "high";
const RPM_2512 = Number(opt("rpm-2512", "6"));
const NOISE = !args.includes("--no-noise");
const CANDIDATE = opt("candidate", "l4") as "l4" | "small" | "glm-flash";

// ─── Models ─────────────────────────────────────────────────────────────────
// Prices per million tokens (input / output; reasoning is billed as output).
// 2512: lib/session-cost.ts. Large 4: third-party listings, Nov 2026 —
// unconfirmed against Mistral's own pricing page.

interface Variant {
  id: string;
  model: string;
  effort?: string;
  rpm: number;
  price: { in: number; out: number };
  /** Extra max_tokens on top of production's budget — room for the reasoning. */
  extraTokens: number;
}

const REF: Variant = { id: "2512", model: "mistral-large-2512", rpm: RPM_2512, price: { in: 0.5, out: 1.5 }, extraTokens: 0 };
const REF_B: Variant = { ...REF, id: "2512-bis" };
const L4: Variant = { id: `L4-${EFFORT}`, model: "mistral-large-latest", effort: EFFORT, rpm: 60, price: { in: 0.7, out: 2.1 }, extraTokens: 6000 };
// mistral-small-latest: non-reasoning, 100 requests/minute on the account; price from lib/session-cost.ts.
const SMALL: Variant = { id: "small", model: "mistral-small-latest", rpm: 60, price: { in: 0.15, out: 0.6 }, extraTokens: 0 };
// zai-glm-5-3-flash: Z.ai's GLM 5.3 Flash hosted by Mistral, reasoning ("none" refused; "low" barely
// reasons), 333 requests/minute on the account. Price: Z.ai's own list price — Mistral's unconfirmed.
const GLM_FLASH: Variant = { id: `glm-flash-${EFFORT}`, model: "zai-glm-5-3-flash", effort: EFFORT, rpm: 60, price: { in: 0.15, out: 0.5 }, extraTokens: 4000 };
const CAND = CANDIDATE === "small" ? SMALL : CANDIDATE === "glm-flash" ? GLM_FLASH : L4;
const VARIANTS = NOISE ? [REF, REF_B, CAND] : [REF, CAND];

// One gate per model (2512 and 2512-bis share it): calls start at least
// 60/rpm seconds apart.
const gates = new Map<string, Promise<void>>();
function throttle(v: Variant): Promise<void> {
  const prev = gates.get(v.model) ?? Promise.resolve();
  const next = prev.then(() => new Promise<void>((r) => setTimeout(r, 60_000 / v.rpm)));
  gates.set(v.model, next);
  return prev;
}

interface Call {
  text: string | null;
  ms: number;
  tokensIn: number;
  tokensOut: number;
  reasoning: number;
  finish: string;
  error?: string;
}

async function callModel(v: Variant, system: string, user: string, maxTokens: number): Promise<Call> {
  for (let attempt = 0; ; attempt++) {
    await throttle(v);
    const t0 = Date.now();
    const res = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${requireApiKey()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: v.model,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        max_tokens: maxTokens + v.extraTokens,
        response_format: { type: "json_object" },
        ...(v.effort ? { reasoning_effort: v.effort } : {}),
      }),
    }).catch((e) => e as Error);
    const ms = Date.now() - t0;
    if (res instanceof Error) return { text: null, ms, tokensIn: 0, tokensOut: 0, reasoning: 0, finish: "network", error: res.message };
    if (res.status === 429 && attempt < 5) {
      console.warn(`  ${v.id}: 429, waiting 30 s`);
      await new Promise((r) => setTimeout(r, 30_000));
      continue;
    }
    if (!res.ok) return { text: null, ms, tokensIn: 0, tokensOut: 0, reasoning: 0, finish: `http ${res.status}`, error: (await res.text()).slice(0, 200) };
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: unknown }; finish_reason?: string }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } };
    };
    return {
      text: contentText(data.choices?.[0]?.message?.content),
      ms,
      tokensIn: data.usage?.prompt_tokens ?? 0,
      tokensOut: data.usage?.completion_tokens ?? 0,
      reasoning: data.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
      finish: data.choices?.[0]?.finish_reason ?? "?",
    };
  }
}

// ─── Stats helpers ──────────────────────────────────────────────────────────

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const r1 = (x: number) => (Number.isFinite(x) ? String(Math.round(x * 10) / 10) : "—");
const pct = (q: number, xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};
const usd = (v: Variant, calls: Call[]) => calls.reduce((s, c) => s + (c.tokensIn * v.price.in + c.tokensOut * v.price.out) / 1e6, 0);

// ─── Runs ───────────────────────────────────────────────────────────────────

interface JudgeRun { call: Call; verdict: JudgeResult | null; score: number | null }
interface TurnRow { session: string; lang: string; turn: number; words: number; runs: Record<string, JudgeRun> }
interface CefrRun { call: Call; score: number | null; level: string | null }
interface SessionRow { session: string; lang: string; runs: Record<string, CefrRun> }

async function judgeTurn(v: Variant, evidence: string, liveWords: string[]): Promise<JudgeRun> {
  const call = await callModel(v, JUDGE_SYSTEM, evidence, 2000);
  let verdict: JudgeResult | null = null;
  try {
    verdict = call.text ? parseJudgeReply(call.text) : null;
  } catch {
    verdict = null;
  }
  return { call, verdict, score: verdict ? scoreFromVerdict(liveWords, verdict).score : null };
}

async function cefrSession(v: Variant, lang: ConvLang, userTurns: string[], pron: PronunciationAvg | null, steps: Parameters<typeof withC2Evidence>[1]): Promise<CefrRun> {
  const call = await callModel(v, CEFR_SYSTEM_PROMPT, buildEvaluationUserMessage(lang, userTurns, pron ?? undefined), 1500);
  try {
    if (!call.text) throw new Error("empty");
    const result = withC2Evidence(withAnswerEvidence(parseCefrEvaluation(call.text), userTurns), steps);
    const { score, level } = computeCompositeCefrScore(result, pron);
    return { call, score, level };
  } catch {
    return { call, score: null, level: null };
  }
}

async function main() {
  const sb = getSupabaseServer();
  const azKey = process.env.AZURE_SPEECH_KEY;
  const azRegion = process.env.AZURE_SPEECH_REGION ?? "westeurope";
  if (!azKey) throw new Error("AZURE_SPEECH_KEY missing");

  const turnRows: TurnRow[] = [];
  const sessionRows: SessionRow[] = [];

  for (const lang of LANGS) {
    const { data: sessions, error } = await sb
      .from("sessions").select("id, language, pronunciation_scores, ladder_json, created_at")
      .eq("language", lang).gte("created_at", SINCE).not("evaluation_json", "is", null)
      .or("source.is.null,source.neq.simulation").order("created_at", { ascending: false }).limit(PER_LANG * 4);
    if (error) throw error;
    let done = 0;
    for (const s of sessions ?? []) {
      if (done >= PER_LANG) break;
      const { data: turns } = await sb.from("session_turns").select("turn_index, role, content, audio_url").eq("session_id", s.id).order("turn_index");
      const all = turns ?? [];
      const userTurns = all.filter((t) => t.role === "user").map((t) => t.content as string).filter((c) => c?.trim());
      const audioTurns = all.filter((t) => t.role === "user" && t.audio_url && (t.content as string)?.trim().split(/\s+/).length >= 4).slice(0, MAX_TURNS);
      if (!audioTurns.length || !userTurns.length) continue;
      done++;
      const sid = s.id.slice(0, 8);
      console.log(`${lang} ${sid}: ${audioTurns.length} turns`);

      // CEFR evaluation — every variant, in parallel (the gates space the calls).
      const pron = s.pronunciation_scores as PronunciationAvg | null;
      const steps = (s.ladder_json as { steps?: Parameters<typeof withC2Evidence>[1] } | null)?.steps ?? [];
      const cefrPromise = Promise.all(VARIANTS.map((v) => cefrSession(v, lang as ConvLang, userTurns, pron, steps)));

      // Pronunciation judge — evidence once per turn, then every variant.
      const turnPromises = audioTurns.map(async (t) => {
        const path = recordingPath(t.audio_url as string);
        if (!path) return null;
        const { data: file } = await sb.storage.from("recordings").download(path);
        if (!file) return null;
        const audio = await file.arrayBuffer();
        const ct = "audio/wav; codecs=audio/pcm; samplerate=16000";
        const [dg, az] = await Promise.all([verbatimHearing(audio, ct, lang), azureAcoustic(audio, ct, lang, azKey, azRegion)]);
        const live = t.content as string;
        const context = (all.filter((x) => x.role === "assistant" && x.turn_index < t.turn_index).pop()?.content as string) ?? "";
        const evidence = buildJudgeEvidence(live, LANG_LABELS[lang] ?? "English", context, dg, az);
        const liveWords = live.trim().split(/\s+/).filter(Boolean);
        const runs = await Promise.all(VARIANTS.map((v) => judgeTurn(v, evidence, liveWords)));
        const row: TurnRow = { session: sid, lang, turn: t.turn_index, words: liveWords.length, runs: Object.fromEntries(VARIANTS.map((v, i) => [v.id, runs[i]])) };
        console.log(`  turn ${t.turn_index}: ${VARIANTS.map((v) => `${v.id}=${row.runs[v.id].score ?? "fail"} (${Math.round(row.runs[v.id].call.ms / 100) / 10}s)`).join("  ")}`);
        return row;
      });

      for (const r of await Promise.all(turnPromises)) if (r) turnRows.push(r);
      const cefr = await cefrPromise;
      sessionRows.push({ session: sid, lang, runs: Object.fromEntries(VARIANTS.map((v, i) => [v.id, cefr[i]])) });
      console.log(`  CEFR: ${VARIANTS.map((v, i) => `${v.id}=${cefr[i].score ?? "fail"} ${cefr[i].level ?? ""}`).join("  ")}`);
    }
  }

  writeReport(turnRows, sessionRows);
}

// ─── Report ─────────────────────────────────────────────────────────────────

function writeReport(turnRows: TurnRow[], sessionRows: SessionRow[]) {
  const ids = VARIANTS.map((v) => v.id);
  const out: string[] = [
    `# Large-model replay: mistral-large-2512 vs ${CAND.model}${CAND.effort ? ` (${CAND.effort})` : ""} —${new Date().toISOString().slice(0, 16)}\n`,
    `${sessionRows.length} sessions (${LANGS.join(", ")}) · ${turnRows.length} judged turns · variants: ${ids.join(", ")}` +
      (NOISE ? " (2512-bis = second 2512 run, the noise yardstick)" : "") + "\n",
  ];

  // Score gaps against the 2512 reference.
  const gap = (a: (number | null)[], b: (number | null)[]) => {
    const d = a.map((x, i) => (x != null && b[i] != null ? (b[i] as number) - x : null)).filter((x): x is number => x != null);
    return { mean: mean(d), abs: mean(d.map(Math.abs)), n: d.length, over5: d.filter((x) => Math.abs(x) > 5).length };
  };
  const wordAgreement = (other: string) => {
    let same = 0, total = 0;
    for (const r of turnRows) {
      const a = r.runs[REF.id].verdict?.words, b = r.runs[other].verdict?.words;
      if (!a || !b) continue;
      for (let i = 0; i < r.words; i++) {
        total++;
        if ((a[i]?.v ?? "ok") === (b[i]?.v ?? "ok")) same++;
      }
    }
    return total ? (100 * same) / total : NaN;
  };

  out.push("\n## Pronunciation judge\n", "| vs 2512 | mean Δ | mean \\|Δ\\| | turns \\|Δ\\| > 5 | same word verdict |", "|---|---|---|---|---|");
  for (const id of ids.slice(1)) {
    const g = gap(turnRows.map((r) => r.runs[REF.id].score), turnRows.map((r) => r.runs[id].score));
    out.push(`| ${id} | ${r1(g.mean)} | ${r1(g.abs)} | ${g.over5}/${g.n} | ${r1(wordAgreement(id))} % |`);
  }

  // Session pronunciation averages (what the level sees).
  const sessAvg = (sid: string, id: string) => mean(turnRows.filter((r) => r.session === sid && r.runs[id].score != null).map((r) => r.runs[id].score as number));
  out.push("\n### Session pronunciation averages\n", `| session | lang | ${ids.join(" | ")} |`, `|---|---|${ids.map(() => "---").join("|")}|`);
  for (const s of sessionRows) out.push(`| ${s.session} | ${s.lang} | ${ids.map((id) => r1(sessAvg(s.session, id))).join(" | ")} |`);

  out.push("\n## CEFR evaluation\n", "| vs 2512 | mean Δ score | mean \\|Δ\\| | same level |", "|---|---|---|---|");
  for (const id of ids.slice(1)) {
    const g = gap(sessionRows.map((s) => s.runs[REF.id].score), sessionRows.map((s) => s.runs[id].score));
    const both = sessionRows.filter((s) => s.runs[REF.id].level && s.runs[id].level);
    const same = both.filter((s) => s.runs[REF.id].level === s.runs[id].level).length;
    out.push(`| ${id} | ${r1(g.mean)} | ${r1(g.abs)} | ${same}/${both.length} |`);
  }
  out.push("", `| session | lang | ${ids.join(" | ")} |`, `|---|---|${ids.map(() => "---").join("|")}|`);
  for (const s of sessionRows) out.push(`| ${s.session} | ${s.lang} | ${ids.map((id) => (s.runs[id].score != null ? `${s.runs[id].score} ${s.runs[id].level}` : "fail")).join(" | ")} |`);

  // Latency, tokens, cost, failures.
  out.push("\n## Latency, tokens, cost\n", "| variant | call | p50 s | p90 s | tokens in | tokens out | of which reasoning | failures | truncated | $ per call |", "|---|---|---|---|---|---|---|---|---|---|");
  for (const v of VARIANTS) {
    for (const [label, calls, failed] of [
      ["judge", turnRows.map((r) => r.runs[v.id].call), turnRows.filter((r) => r.runs[v.id].score == null).length],
      ["CEFR", sessionRows.map((s) => s.runs[v.id].call), sessionRows.filter((s) => s.runs[v.id].score == null).length],
    ] as const) {
      const ms = calls.map((c) => c.ms / 1000);
      out.push(
        `| ${v.id} | ${label} | ${r1(pct(0.5, ms))} | ${r1(pct(0.9, ms))} | ${Math.round(mean(calls.map((c) => c.tokensIn)))} | ${Math.round(mean(calls.map((c) => c.tokensOut)))} | ${Math.round(mean(calls.map((c) => c.reasoning)))} | ${failed}/${calls.length} | ${calls.filter((c) => c.finish === "length").length} | ${(usd(v, calls) / Math.max(1, calls.length)).toFixed(4)} |`,
      );
    }
  }
  const prodBudget = turnRows.filter((r) => r.runs[CAND.id].call.tokensOut > 2000).length + sessionRows.filter((s) => s.runs[CAND.id].call.tokensOut > 1500).length;
  out.push(`\n${CAND.id} calls that would have overrun production's max_tokens (judge 2000, CEFR 1500): ${prodBudget}/${turnRows.length + sessionRows.length}`);
  out.push(`Prices per M tokens: 2512 $${REF.price.in}/$${REF.price.out}, ${CAND.model} $${CAND.price.in}/$${CAND.price.out}${CAND === SMALL ? "" : " (unconfirmed)"}.`);

  // Per-turn detail.
  out.push("\n## Turns\n", `| session | lang | turn | words | ${ids.join(" | ")} |`, `|---|---|---|---|${ids.map(() => "---").join("|")}|`);
  for (const r of turnRows) out.push(`| ${r.session} | ${r.lang} | ${r.turn} | ${r.words} | ${ids.map((id) => r.runs[id].score ?? `fail (${r.runs[id].call.finish})`).join(" | ")} |`);

  mkdirSync("sim-runs", { recursive: true });
  const file = `sim-runs/judge-model-replay-${CAND.id}-${new Date().toISOString().slice(0, 16).replace(":", "-")}.md`;
  writeFileSync(file, out.join("\n") + "\n");
  console.log(out.slice(0, out.indexOf("\n## Turns\n")).join("\n"));
  console.log(`\nWritten ${file}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
