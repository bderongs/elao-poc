/**
 * C1/C2 report — which signal best tells a C1 speaker from a C2 one?
 *
 *   npm run analysis:c1c2
 *   npm run analysis:c1c2 -- --min-words 60      # skip candidates who said less (default 60)
 *
 * On the C1/C2 set (scripts/calibration-set.ts build-c1c2, then
 * `compare <engines> --set c1c2`): every candidate ELAO rated C2 globally plus
 * as many rated C1. The reference is the GLOBAL level — the oral one is
 * Speechace's own verdict (it would make Speechace win by construction) and
 * almost never says C2.
 *
 * For each signal (each engine's pronunciation, accuracy and speaking rate,
 * and Speechace's scores as a yardstick): AUC = the chance that a random C2
 * candidate scores higher than a random C1 one (0.5 = coin flip, 1 = always),
 * with a bootstrap 95 % interval. "vs best" is a paired bootstrap of the AUC
 * difference with the best signal on the same candidates: an interval that
 * contains 0 means the two can't be told apart on this sample.
 *
 * Engines are compared on the candidates every engine scored on every
 * recorded answer (like-for-like). Read-only, no API calls.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
for (const f of [".env", ".env.local"]) if (existsSync(f)) process.loadEnvFile(f);
import { getSupabaseServer } from "../lib/supabase-server";
import { computePronunciationAvg } from "../lib/pronunciation-rollup";
import type { PronunciationResult } from "../lib/pronunciation/types";
import type { SpeechaceScores } from "../lib/types";

const args = process.argv.slice(2);
const opt = (n: string, d?: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const MIN_WORDS = Number(opt("min-words", "60"));
const sb = getSupabaseServer();

const base = (l: string | null | undefined) => (l ?? "").replace(/\s*\(.*\)|\.\d+|\+/g, "").trim();
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);

interface Cand { id: string; language: string; c2: boolean; values: Map<string, number> }

// ─── Disfluency measures, from the verbatim transcripts (scripts/calibration-set.ts verbatim) ───

const VERBATIM_DIR = "analysis/reports/verbatim";
interface Verbatim { sessionId: string; language: string; plain: string; segments: Array<{ text: string; start: number; end: number }> }
/** Hesitation sounds, per language; matched as whole words. */
const FILLERS: Record<string, RegExp> = {
  en: /^(u+m+|u+h+|e+r+m*|h+m+|a+h+|e+h+|mm+)$/,
  fr: /^(e+u+h+|h+e+u+|h+u+m+|h+m+|e+h+|mm+)$/,
  es: /^(e+h+|e+m+|m+h*|este)$/,
};
const tokens = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, " ").split(/\s+/).filter(Boolean);
/** Signals where fewer means more proficient: AUC is computed on the negated value. */
const LOWER_IS_BETTER = new Set(["hesitations per 100 words", "repetitions per 100 words", "pause share", "long pauses (> 1 s) per minute"].map((s) => `verbatim — ${s}`));

function disfluency(turns: Verbatim[]): Map<string, number> {
  const out = new Map<string, number>();
  let words = 0, fillers = 0, repeats = 0, segWords = 0, spoken = 0, span = 0, longPauses = 0, runs = 0;
  for (const t of turns) {
    const filler = FILLERS[t.language] ?? FILLERS.en;
    const all = tokens(t.plain);
    const content = all.filter((w) => !filler.test(w));
    fillers += all.length - content.length;
    words += content.length;
    // "if, um, if I…" / "one, one aspect": the same word twice in a row once hesitations are taken out.
    for (let i = 1; i < content.length; i++) if (content[i] === content[i - 1]) repeats++;
    const segs = t.segments.filter((s) => s.end > s.start);
    if (!segs.length) continue;
    segWords += segs.reduce((a, s) => a + tokens(s.text).length, 0);
    spoken += segs.reduce((a, s) => a + (s.end - s.start), 0);
    span += segs[segs.length - 1].end - segs[0].start;
    for (let i = 1; i < segs.length; i++) if (segs[i].start - segs[i - 1].end > 1) longPauses++;
    runs += segs.length;
  }
  if (words >= 20) {
    out.set("verbatim — hesitations per 100 words", (100 * fillers) / words);
    out.set("verbatim — repetitions per 100 words", (100 * repeats) / words);
  }
  if (span > 10 && spoken > 0) {
    out.set("verbatim — speech rate (words/min, pauses included)", segWords / (span / 60));
    out.set("verbatim — articulation rate (words/min, pauses excluded)", segWords / (spoken / 60));
    out.set("verbatim — pause share", 1 - spoken / span);
    out.set("verbatim — long pauses (> 1 s) per minute", longPauses / (span / 60));
    out.set("verbatim — words per stretch of speech", segWords / runs);
  }
  return out;
}

function loadVerbatim(): Map<string, Verbatim[]> {
  const bySession = new Map<string, Verbatim[]>();
  if (!existsSync(VERBATIM_DIR)) return bySession;
  for (const f of readdirSync(VERBATIM_DIR).filter((f) => f.endsWith(".json"))) {
    const v = JSON.parse(readFileSync(`${VERBATIM_DIR}/${f}`, "utf8")) as Verbatim;
    bySession.set(v.sessionId, [...(bySession.get(v.sessionId) ?? []), v]);
  }
  return bySession;
}

/** AUC (Mann–Whitney): ties count half. Oriented so that 1 = C2 always on the proficient side. */
function auc(cands: Cand[], signal: string): number {
  const sign = LOWER_IS_BETTER.has(signal) ? -1 : 1;
  const pos = cands.filter((c) => c.c2).map((c) => sign * c.values.get(signal)!), neg = cands.filter((c) => !c.c2).map((c) => sign * c.values.get(signal)!);
  let s = 0;
  for (const p of pos) for (const n of neg) s += p > n ? 1 : p === n ? 0.5 : 0;
  return s / (pos.length * neg.length);
}

/** Stratified bootstrap (C1 and C2 resampled separately), fixed seed so reruns agree. */
function bootstrap(cands: Cand[], stat: (xs: Cand[]) => number, n = 2000): [number, number] {
  let seed = 12345;
  const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32;
  const pos = cands.filter((c) => c.c2), neg = cands.filter((c) => !c.c2);
  const draw = (xs: Cand[]) => xs.map(() => xs[Math.floor(rnd() * xs.length)]);
  const out = Array.from({ length: n }, () => stat([...draw(pos), ...draw(neg)])).sort((a, b) => a - b);
  return [out[Math.floor(n * 0.025)], out[Math.floor(n * 0.975)]];
}

(async () => {
  const { data: sessions, error } = await sb.from("sessions").select("id, language, speechace_scores").eq("source", "speechace").eq("speechace_scores->reference->>c1c2", "true");
  if (error) throw new Error(error.message);

  const turnsOf = new Map<string, string[]>(), sessionOfTurn = new Map<string, string>(), words = new Map<string, number>();
  const ids = (sessions ?? []).map((s) => s.id as string);
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await sb.from("session_turns").select("id, session_id, content, audio_url").in("session_id", ids.slice(i, i + 100)).eq("role", "user");
    for (const t of data ?? []) {
      words.set(t.session_id, (words.get(t.session_id) ?? 0) + String(t.content ?? "").split(/\s+/).filter(Boolean).length);
      if (!t.audio_url) continue;
      turnsOf.set(t.session_id, [...(turnsOf.get(t.session_id) ?? []), t.id]);
      sessionOfTurn.set(t.id, t.session_id);
    }
  }
  // Latest successful run per answer and engine.
  const latest = new Map<string, { at: string; result: PronunciationResult }>();
  const turnIds = [...sessionOfTurn.keys()];
  for (let i = 0; i < turnIds.length; i += 200) {
    const { data } = await sb.from("session_turn_evaluations").select("turn_id, provider_id, result_json, created_at").in("turn_id", turnIds.slice(i, i + 200)).not("result_json", "is", null);
    for (const r of data ?? []) {
      const k = `${r.turn_id}|${r.provider_id}`;
      if (!latest.has(k) || latest.get(k)!.at < r.created_at) latest.set(k, { at: r.created_at, result: r.result_json as PronunciationResult });
    }
  }
  const byEngine = new Map<string, Map<string, PronunciationResult[]>>();
  for (const [k, v] of latest) {
    const [turnId, engine] = k.split("|");
    const sid = sessionOfTurn.get(turnId)!;
    if (!byEngine.has(engine)) byEngine.set(engine, new Map());
    byEngine.get(engine)!.set(sid, [...(byEngine.get(engine)!.get(sid) ?? []), v.result]);
  }
  const complete = (e: string, sid: string) => (byEngine.get(e)?.get(sid)?.length ?? 0) === (turnsOf.get(sid)?.length ?? -1);
  // An engine counts once it covers most of the set (a stray admin run doesn't).
  const engines = [...byEngine.keys()].filter((e) => ids.filter((sid) => complete(e, sid)).length >= ids.length / 2).sort();

  const verbatim = loadVerbatim();
  const all: Cand[] = [];
  let tooShort = 0, noRecording = 0, incomplete = 0;
  for (const s of sessions ?? []) {
    const ref = (s.speechace_scores as SpeechaceScores).reference!;
    const lvl = base(ref.global_level);
    if (lvl !== "C1" && lvl !== "C2") continue;
    if ((words.get(s.id) ?? 0) < MIN_WORDS) { tooShort++; continue; }
    if (!turnsOf.get(s.id)?.length) { noRecording++; continue; }
    if (!engines.every((e) => complete(e, s.id))) { incomplete++; continue; }
    const sa = s.speechace_scores as SpeechaceScores;
    const values = new Map<string, number>();
    if (sa.pronunciation !== null) values.set("Speechace pronunciation", sa.pronunciation);
    if (sa.fluency !== null) values.set("Speechace fluency", sa.fluency);
    if (sa.overall !== null) values.set("Speechace overall", sa.overall);
    for (const e of engines) {
      const results = byEngine.get(e)!.get(s.id)!;
      const avg = computePronunciationAvg(results);
      if (!avg) continue;
      values.set(`${e} — pronunciation`, avg.pronunciation);
      values.set(`${e} — accuracy`, mean(results.map((r) => r.accuracyScore ?? 0)));
      if (avg.wpm > 0 && avg.wpm < 250) values.set(`${e} — speaking rate`, avg.wpm);
    }
    // Disfluency only when every recorded answer was transcribed verbatim.
    const v = verbatim.get(s.id);
    if (v && v.length === turnsOf.get(s.id)!.length) for (const [k, x] of disfluency(v)) values.set(k, x);
    all.push({ id: s.id, language: s.language, c2: lvl === "C2", values });
  }

  const out: string[] = [];
  const p = (l = "") => out.push(l);
  const signals = [...new Set(all.flatMap((c) => [...c.values.keys()]))];
  p("# C1 vs C2 — which signal tells them apart?");
  p();
  p(`C1/C2 set: ${ids.length} candidates; ${all.length} compared (${all.filter((c) => c.c2).length} global C2, ${all.filter((c) => !c.c2).length} global C1). Left out: ${tooShort} under ${MIN_WORDS} words, ${noRecording} without recordings, ${incomplete} not scored by every engine (${engines.join(", ")}).`);
  p();
  p("Reference: ELAO's **global** level. AUC = chance a random C2 is on the proficient side of a random C1 (0.5 = coin flip, 1 = always); ↓ = fewer is more proficient (hesitations, repeats, pauses). vs best = paired difference with the best signal; an interval containing 0 = can't be told apart on this sample.");
  if (verbatim.size) p(`Verbatim transcripts (hesitations, repeats, timed speech): ${verbatim.size} candidates.`);

  for (const [title, cands] of [["All languages", all], ...[...new Set(all.map((c) => c.language))].sort().map((l) => [`Language: ${l}`, all.filter((c) => c.language === l)] as const)] as [string, Cand[]][]) {
    const nPos = cands.filter((c) => c.c2).length, nNeg = cands.length - nPos;
    if (nPos < 5 || nNeg < 5) { p(); p(`## ${title}`); p(); p(`Too few to compare (${nPos} C2, ${nNeg} C1).`); continue; }
    // Each signal on the candidates it covers (most cover all; verbatim may lag); "vs best" on the ones both cover.
    const has = (s: string) => cands.filter((c) => c.values.has(s));
    const usable = signals.filter((s) => { const xs = has(s); return xs.filter((c) => c.c2).length >= 5 && xs.filter((c) => !c.c2).length >= 5; });
    const ranked = usable.map((s) => ({ s, a: auc(has(s), s) })).sort((x, y) => y.a - x.a);
    const best = ranked[0].s;
    p();
    p(`## ${title} — ${nPos} C2, ${nNeg} C1`);
    p();
    p("| Signal | n | Mean C1 | Mean C2 | AUC | 95 % interval | vs best |");
    p("|---|---|---|---|---|---|---|");
    for (const { s, a } of ranked) {
      const xs = has(s);
      const [lo, hi] = bootstrap(xs, (ys) => auc(ys, s));
      const m = (c2: boolean) => mean(xs.filter((c) => c.c2 === c2).map((c) => c.values.get(s)!)).toFixed(1);
      let vs = "—";
      if (s !== best) {
        const both = xs.filter((c) => c.values.has(best));
        const [dlo, dhi] = bootstrap(both, (ys) => auc(ys, best) - auc(ys, s));
        vs = `${(auc(both, best) - auc(both, s)).toFixed(2)} [${dlo.toFixed(2)}, ${dhi.toFixed(2)}]${dlo > 0 ? " worse" : ""}`;
      }
      const label = `${s}${LOWER_IS_BETTER.has(s) ? " ↓" : ""}`;
      p(`| ${s.startsWith("Speechace") ? `*${label}*` : label} | ${xs.length} | ${m(false)} | ${m(true)} | **${a.toFixed(2)}** | ${lo.toFixed(2)}–${hi.toFixed(2)} | ${vs} |`);
    }
  }

  const report = out.join("\n") + "\n";
  console.log(report);
  mkdirSync("analysis/reports", { recursive: true });
  const file = `analysis/reports/c1c2-${new Date().toISOString().slice(0, 16).replace(/:/g, "-")}.md`;
  writeFileSync(file, report);
  console.log(`→ ${file}`);
})().catch((e) => { console.error(e); process.exit(1); });
