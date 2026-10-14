/**
 * Calibration report — how our oral evaluation compares with the reference
 * levels of the calibration set (real candidates, levels from the client's
 * ELAO exports; built and scored by scripts/calibration-set.ts).
 *
 *   npm run analysis:calibration                        # latest live-model evaluations at the current prompt
 *   npm run analysis:calibration -- --prompt v6 --model <eval model id>
 *   npm run analysis:calibration -- --variants pron-stretch,pron-linear   # compare rule sets (analysis/scenarios.ts) on the same evaluations
 *
 * Two references, neither of them ground truth:
 *   oral    the Speechace speaking level ELAO derived (mostly acoustic)
 *   global  ELAO's level across its other tests (grammar, vocabulary, listening…)
 * so "within one level" matters more than exact matches.
 *
 * The Speechace format is five short monologues with no C2 questions and no
 * difficulty ladder, so the C2 gate always holds these sessions below C2: the
 * "level" column is computed with the gate off, and the report says how many
 * the gate would have held back.
 *
 * Pronunciation engines: when the set was also run through other engines
 * (scripts/calibration-set.ts compare …), each is compared on the sessions
 * every engine fully covered — agreement with Speechace's pronunciation
 * score, how well it ranks candidates by level, and our level with its score
 * in place of the live engine's.
 *
 * Read-only, no API calls. Full guide: analysis/README.md
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
for (const f of [".env", ".env.local"]) if (existsSync(f)) process.loadEnvFile(f);
import { getSupabaseServer } from "../lib/supabase-server";
import { SCORING_RULES, scoreWithRules } from "../lib/cefr-score";
import { CEFR_PROMPT_VERSION } from "../lib/cefr-prompt";
import { SCENARIOS } from "./scenarios";
import type { ScoringRules } from "../lib/cefr-score";
import { LIVE_CONVERSATION_MODEL_ID } from "../lib/llm/live-provider";
import { computePronunciationAvg } from "../lib/pronunciation-rollup";
import type { PronunciationResult } from "../lib/pronunciation/types";
import type { CefrResult, PronunciationAvg, SpeechaceScores } from "../lib/types";

const args = process.argv.slice(2);
const opt = (n: string, d?: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const prompt = opt("prompt", CEFR_PROMPT_VERSION)!;
const model = opt("model", LIVE_CONVERSATION_MODEL_ID)!;

const LEVELS = ["A0", "A1", "A2", "B1", "B2", "C1", "C2"];
/** "B2 (75)", "C1.4", "B1+" → index of "B2", "C1", "B1"; -1 when unknown. */
const levelIndex = (l: string | null | undefined) => LEVELS.indexOf((l ?? "").replace(/\s*\(.*\)|\.\d+|\+/g, "").trim());
const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)} %` : "—");

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
function pearson(xs: number[], ys: number[]): number {
  const mx = mean(xs), my = mean(ys);
  const cov = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0);
  const sx = Math.sqrt(xs.reduce((a, x) => a + (x - mx) ** 2, 0));
  const sy = Math.sqrt(ys.reduce((a, y) => a + (y - my) ** 2, 0));
  return sx && sy ? cov / (sx * sy) : NaN;
}
/** Rank correlation (ties share their mean rank) — how well a score orders candidates. */
function spearman(xs: number[], ys: number[]): number {
  const rank = (v: number[]) => {
    const order = v.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
    const r = new Array<number>(v.length);
    for (let i = 0; i < order.length; ) {
      let j = i;
      while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
      for (let k = i; k <= j; k++) r[order[k][1]] = (i + j) / 2;
      i = j + 1;
    }
    return r;
  };
  return pearson(rank(xs), rank(ys));
}

interface Row {
  id: string;
  language: string;
  ours: number;
  oursLabel: string;
  heldByGate: boolean;
  oral: number;
  global: number;
  ourPron: number | null;
  saPron: number | null;
  result: CefrResult;
  pron: PronunciationAvg | null;
}

async function main() {
  const sb = getSupabaseServer();
  const { data: sessions, error } = await sb
    .from("sessions")
    .select("id, language, speechace_scores, pronunciation_scores")
    .eq("source", "speechace")
    .eq("speechace_scores->reference->>calibration", "true");
  if (error) throw new Error(error.message);
  if (!sessions?.length) { console.log("No calibration set yet — run scripts/calibration-set.ts build."); return; }

  const { data: evals, error: e2 } = await sb
    .from("session_evaluations")
    .select("session_id, result_json, created_at")
    .in("session_id", sessions.map((s) => s.id))
    .eq("model_id", model)
    .eq("prompt_version", prompt)
    .not("result_json", "is", null)
    .order("created_at", { ascending: false });
  if (e2) throw new Error(e2.message);
  const latest = new Map<string, CefrResult>();
  for (const e of evals ?? []) if (!latest.has(e.session_id)) latest.set(e.session_id, e.result_json as CefrResult);

  const noGate = { ...SCORING_RULES, c2Gate: null };
  const rows: Row[] = [];
  for (const s of sessions) {
    const result = latest.get(s.id);
    const ref = (s.speechace_scores as SpeechaceScores).reference!;
    if (!result) continue;
    const pron = (s.pronunciation_scores as PronunciationAvg | null) ?? null;
    const ungated = scoreWithRules(result, pron, noGate);
    const live = scoreWithRules(result, pron, SCORING_RULES);
    rows.push({
      id: s.id,
      language: s.language,
      ours: levelIndex(ungated.level),
      oursLabel: `${ungated.level} (${ungated.score})`,
      heldByGate: live.level !== ungated.level,
      oral: levelIndex(ref.oral_level),
      global: levelIndex(ref.global_level),
      ourPron: pron ? pron.pronunciation : null,
      saPron: (s.speechace_scores as SpeechaceScores).pronunciation,
      result,
      pron,
    });
  }

  const out: string[] = [];
  const p = (l = "") => out.push(l);
  const variants = (opt("variants") ?? "").split(",").map((v) => v.trim()).filter(Boolean);
  p(`# Calibration — prompt ${prompt}, model ${model}`);
  p();
  p(`Calibration set: ${sessions.length} sessions, ${rows.length} evaluated with this prompt and model.`);
  if (rows.length < sessions.length) p(`⚠ ${sessions.length - rows.length} not evaluated yet — run \`npx tsx scripts/calibration-set.ts score\`.`);
  p(`Levels below are computed with the C2 gate off (no C2 questions in this format); the gate would hold back ${rows.filter((r) => r.heldByGate).length}.`);
  p();

  if (variants.length) {
    // Same evaluations, other rule sets (gate off, as above): what a formula change would do to agreement.
    const sets: [string, ScoringRules][] = [["(production)", noGate], ...variants.map((v) => {
      if (!SCENARIOS[v]) throw new Error(`Unknown scenario "${v}" (analysis/scenarios.ts)`);
      return [v, { ...noGate, ...SCENARIOS[v].overrides, c2Gate: null }] as [string, ScoringRules];
    })];
    p("## Rule variants (same evaluations)");
    p();
    p(`| Rules | Within one: global | Same: global | Bias global | Within one: oral | Bias oral | Mean difference by global level ${LEVELS.slice(1).join(" / ")} |`);
    p("|---|---|---|---|---|---|---|");
    for (const [name, rules] of sets) {
      const lv = new Map(rows.map((r) => [r.id, levelIndex(scoreWithRules(r.result, r.pron, rules).level)]));
      const g = rows.filter((r) => r.global >= 0), o = rows.filter((r) => r.oral >= 0);
      const d = (xs: Row[], k: "global" | "oral") => xs.map((r) => lv.get(r.id)! - r[k]);
      const byLevel = LEVELS.slice(1).map((_, i) => { const xs = rows.filter((r) => r.global === i + 1); return xs.length ? mean(d(xs, "global")).toFixed(1) : "·"; }).join(" / ");
      p(`| ${name} | ${pct(d(g, "global").filter((x) => Math.abs(x) <= 1).length, g.length)} | ${pct(d(g, "global").filter((x) => x === 0).length, g.length)} | ${mean(d(g, "global")).toFixed(2)} | ${pct(d(o, "oral").filter((x) => Math.abs(x) <= 1).length, o.length)} | ${mean(d(o, "oral")).toFixed(2)} | ${byLevel} |`);
    }
    p();
  }

  p("## Agreement");
  p();
  p("| Reference | n | Same level | Within one level | Mean difference (levels, + = we score higher) |");
  p("|---|---|---|---|---|");
  for (const [name, key] of [["Oral (Speechace)", "oral"], ["Global (ELAO tests)", "global"]] as const) {
    const xs = rows.filter((r) => r[key] >= 0 && r.ours >= 0);
    const d = xs.map((r) => r.ours - r[key]);
    p(`| ${name} | ${xs.length} | ${pct(d.filter((x) => x === 0).length, xs.length)} | ${pct(d.filter((x) => Math.abs(x) <= 1).length, xs.length)} | ${xs.length ? (d.reduce((a, b) => a + b, 0) / xs.length).toFixed(2) : "—"} |`);
  }
  p();

  for (const [name, key] of [["oral", "oral"], ["global", "global"]] as const) {
    p(`## Our level (columns) by ${name} reference level (rows)`);
    p();
    p(`| ${name} \\ ours | ${LEVELS.join(" | ")} | n |`);
    p(`|---|${LEVELS.map(() => "---").join("|")}|---|`);
    for (let i = 0; i < LEVELS.length; i++) {
      const xs = rows.filter((r) => r[key] === i);
      if (!xs.length) continue;
      p(`| **${LEVELS[i]}** | ${LEVELS.map((_, j) => { const n = xs.filter((r) => r.ours === j).length; return n ? (i === j ? `**${n}**` : String(n)) : "·"; }).join(" | ")} | ${xs.length} |`);
    }
    p();
  }

  const pr = rows.filter((r) => r.ourPron !== null && r.saPron !== null);
  if (pr.length > 2) {
    const mx = pr.reduce((a, r) => a + r.ourPron!, 0) / pr.length;
    const my = pr.reduce((a, r) => a + r.saPron!, 0) / pr.length;
    const cov = pr.reduce((a, r) => a + (r.ourPron! - mx) * (r.saPron! - my), 0);
    const sx = Math.sqrt(pr.reduce((a, r) => a + (r.ourPron! - mx) ** 2, 0));
    const sy = Math.sqrt(pr.reduce((a, r) => a + (r.saPron! - my) ** 2, 0));
    p("## Pronunciation vs Speechace");
    p();
    p(`${pr.length} sessions: our mean ${mx.toFixed(1)}, Speechace ${my.toFixed(1)} (difference ${(mx - my).toFixed(1)}), correlation r = ${(cov / (sx * sy)).toFixed(2)}.`);
    p();
  }

  // ── Pronunciation engines ──
  const { data: turns } = await sb.from("session_turns").select("id, session_id").in("session_id", rows.map((r) => r.id)).eq("role", "user").not("audio_url", "is", null);
  const sessionOfTurn = new Map((turns ?? []).map((t) => [t.id as string, t.session_id as string]));
  const turnsOfSession = new Map<string, number>();
  for (const t of turns ?? []) turnsOfSession.set(t.session_id, (turnsOfSession.get(t.session_id) ?? 0) + 1);
  const latestRun = new Map<string, { at: string; result: PronunciationResult }>(); // turn|provider → latest successful run
  const turnIds = [...sessionOfTurn.keys()];
  for (let i = 0; i < turnIds.length; i += 200) {
    const { data } = await sb.from("session_turn_evaluations").select("turn_id, provider_id, result_json, created_at").in("turn_id", turnIds.slice(i, i + 200)).not("result_json", "is", null);
    for (const r of data ?? []) {
      const k = `${r.turn_id}|${r.provider_id}`;
      if (!latestRun.has(k) || latestRun.get(k)!.at < r.created_at) latestRun.set(k, { at: r.created_at, result: r.result_json as PronunciationResult });
    }
  }
  const byEngine = new Map<string, Map<string, PronunciationResult[]>>(); // provider → session → results
  for (const [k, v] of latestRun) {
    const [turnId, provider] = k.split("|");
    const sid = sessionOfTurn.get(turnId)!;
    if (!byEngine.has(provider)) byEngine.set(provider, new Map());
    const m = byEngine.get(provider)!;
    m.set(sid, [...(m.get(sid) ?? []), v.result]);
  }
  // An engine counts once it fully covers enough sessions to say something (a stray admin run doesn't).
  const fullyCovered = (e: string) => rows.filter((r) => (byEngine.get(e)!.get(r.id)?.length ?? 0) === turnsOfSession.get(r.id)).length;
  const engines = [...byEngine.keys()].filter((e) => fullyCovered(e) >= 20).sort();
  if (engines.length > 1) {
    // Only sessions every engine scored on every recorded answer: a like-for-like comparison.
    const common = rows.filter((r) => engines.every((e) => (byEngine.get(e)!.get(r.id)?.length ?? 0) === turnsOfSession.get(r.id)));
    p(`## Pronunciation engines (${common.length} sessions scored by all of: ${engines.join(", ")})`);
    p();
    p("Speechace r = correlation with Speechace's pronunciation score. Rank ρ = how well the score orders candidates by reference level (1 = perfectly). Gap = mean score of C1–C2 minus A1–A2 candidates (global level). Level columns: our level with this engine's score in place of the live one (same evaluation, gate off).");
    p();
    p("| Engine | Mean | vs Speechace (mean) | Speechace r | Rank ρ global | Rank ρ oral | Gap C vs A | Level within one: global | oral | Bias global |");
    p("|---|---|---|---|---|---|---|---|---|---|");
    const perLevel: string[] = [];
    for (const e of engines) {
      const avg = new Map(common.map((r) => [r.id, computePronunciationAvg(byEngine.get(e)!.get(r.id)!)!]));
      const pr = common.map((r) => avg.get(r.id)!.pronunciation);
      const sa = common.map((r) => r.saPron ?? NaN);
      const okSa = pr.map((_, i) => i).filter((i) => !isNaN(sa[i]));
      const hi = common.filter((r) => r.global >= 5).map((r) => avg.get(r.id)!.pronunciation);
      const lo = common.filter((r) => r.global >= 0 && r.global <= 2).map((r) => avg.get(r.id)!.pronunciation);
      const lv = common.map((r) => levelIndex(scoreWithRules(r.result, avg.get(r.id)!, noGate).level));
      const g = common.map((r, i) => [lv[i], r.global] as const).filter(([, b]) => b >= 0);
      const o = common.map((r, i) => [lv[i], r.oral] as const).filter(([, b]) => b >= 0);
      p(`| ${e} | ${mean(pr).toFixed(1)} | ${(mean(okSa.map((i) => pr[i])) - mean(okSa.map((i) => sa[i]))).toFixed(1)} | ${pearson(okSa.map((i) => pr[i]), okSa.map((i) => sa[i])).toFixed(2)} | ${spearman(common.filter((r) => r.global >= 0).map((r) => avg.get(r.id)!.pronunciation), common.filter((r) => r.global >= 0).map((r) => r.global)).toFixed(2)} | ${spearman(common.filter((r) => r.oral >= 0).map((r) => avg.get(r.id)!.pronunciation), common.filter((r) => r.oral >= 0).map((r) => r.oral)).toFixed(2)} | ${(mean(hi) - mean(lo)).toFixed(1)} | ${pct(g.filter(([a, b]) => Math.abs(a - b) <= 1).length, g.length)} | ${pct(o.filter(([a, b]) => Math.abs(a - b) <= 1).length, o.length)} | ${mean(g.map(([a, b]) => a - b)).toFixed(2)} |`);
      perLevel.push(`| ${e} | ${LEVELS.map((_, li) => { const xs = common.filter((r) => r.global === li).map((r) => avg.get(r.id)!.pronunciation); return xs.length ? mean(xs).toFixed(0) : "·"; }).join(" | ")} |`);
    }
    const sa = LEVELS.map((_, li) => { const xs = common.filter((r) => r.global === li && r.saPron !== null).map((r) => r.saPron!); return xs.length ? mean(xs).toFixed(0) : "·"; });
    p();
    p("Mean pronunciation score by global reference level:");
    p();
    p(`| Engine | ${LEVELS.join(" | ")} |`);
    p(`|---|${LEVELS.map(() => "---").join("|")}|`);
    for (const l of perLevel) p(l);
    p(`| *Speechace* | ${sa.join(" | ")} |`);
    p(`| *n* | ${LEVELS.map((_, li) => common.filter((r) => r.global === li).length || "·").join(" | ")} |`);
    p();
  }

  const misses = rows.filter((r) => r.global >= 0 && r.oral >= 0 && Math.min(Math.abs(r.ours - r.oral), Math.abs(r.ours - r.global)) >= 2);
  p(`## Two levels or more away from both references (${misses.length})`);
  p();
  if (misses.length) {
    p("| Session | Lang | Ours | Oral | Global |");
    p("|---|---|---|---|---|");
    for (const r of misses) p(`| ${r.id.slice(0, 8)} | ${r.language} | ${r.oursLabel} | ${LEVELS[r.oral]} | ${LEVELS[r.global]} |`);
  } else p("None.");

  const report = out.join("\n");
  console.log(report);
  mkdirSync("analysis/reports", { recursive: true });
  const file = `analysis/reports/calibration-${prompt}-${new Date().toISOString().slice(0, 16).replace(":", "-")}.md`;
  writeFileSync(file, report);
  console.log(`\nSaved to ${file}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
