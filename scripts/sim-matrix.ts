/**
 * Language × level simulation matrix.
 *
 * Plays simulated sessions (lib/conversation-sim.ts — the real examiner, ET,
 * TT, stop rule and final evaluation against an LLM learner at a fixed level)
 * for every language × CEFR level, has a second-vendor LLM judge each
 * conversation, and grades every cell twice — was the conversation right for
 * this learner, and was the final level right — into one grid:
 * ✅ good · 🟠 needs work · 🔴 broken.
 *
 *   npx tsx scripts/sim-matrix.ts                                                  # 6 langs × 6 levels × 3 runs
 *   npx tsx scripts/sim-matrix.ts --lang fr,de --levels A1,C1 --runs 1 --no-save   # smoke test
 *   npx tsx scripts/sim-matrix.ts --resume sim-runs/matrix-<ts>                    # continue / re-report a run
 *
 * Options (all optional):
 *   --lang  fr,en,nl-BE,es,it,de   languages                           (all six)
 *   --levels A1,…,C2               simulated learner levels            (all six)
 *   --runs N                       sessions per cell                   (3)
 *   --start RUNG                   examiner starting rung              (live setting per language, else A2)
 *   --step N                       ET step size                        (live setting per language, else 1)
 *   --fixed N                      fixed length of N answers instead of the adaptive stop rule
 *   --max N                        adaptive cap                        (12)
 *   --no-proxy                     no synthetic pronunciation/WPM (text-only scoring)
 *   --learner mistral|anthropic    who plays the learner               (mistral)
 *   --judge-model ID               Anthropic model judging conversations (claude-sonnet-5-5)
 *   --concurrency N                sessions in parallel                (4)
 *   --no-save                      don't save the sessions to the database
 *   --label TEXT                   tag stored on each saved session
 *   --resume DIR                   reuse DIR: skip sessions already there, then rebuild the reports
 *   --rejudge                      with --resume: re-judge stored sessions not judged by --judge-model
 *                                  (e.g. judged by the Mistral fallback while the Anthropic key was missing)
 *
 * Sessions are played round-robin (run 1 of every cell, then run 2, …) and each
 * is written to DIR/sessions/ as soon as it ends, so an interrupted run still
 * covers the whole grid and --resume picks up where it stopped. Mistral pacing
 * (~26 req/min) sets the speed: about 1.5 min per session.
 *
 * Output: sim-runs/matrix-<timestamp>/ with matrix.md (grids + per-cell detail
 * + analyst reading), matrix.json and matrix.html (clickable heatmap).
 *
 * Caveats, also printed in the report: the learner is an LLM playing a level;
 * the audio proxy (lib/sim-audio-proxy.ts) is drawn from the true level, so
 * the "text-only" level shown next to the final one is the stricter test of
 * the evaluator; the judge is an LLM too. Use the grid to find where to look,
 * then read the transcripts.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

for (const f of [".env", ".env.local"]) if (existsSync(f)) process.loadEnvFile(f);

import type { SimConfig } from "@/lib/conversation-sim";
import { isConvLang, type ConvLang } from "@/lib/conversation-prompts";
import { CEFR_LADDER, isCefrRung, type CefrRung } from "@/lib/cefr-rung";
import { getProvider as getLlmProvider } from "@/lib/llm/registry";
import { resolveConversationSettings } from "@/lib/conversation-settings-service";
import { sampleAudioProxy } from "@/lib/sim-audio-proxy";
import {
  emptySession, installMistralPacing, levelIndex, LEVEL_ORDER, mean, muteConsole, playSession, problemQuestions, r1,
  restoreConsole, runPool, say, summarise, transcriptText, type SessionRecord, type Summary,
} from "./lib/sim-core";

// ─── Verdict thresholds (calibrate here) ─────────────────────────────────────

/** Assessment ✅: every session within this many labels of the simulated level (A2 → A1+…A2+)… */
const ASSESS_GOOD_MAX_ERROR = 1;
/** …and the mean signed bias (over/under-estimation) within this. */
const ASSESS_GOOD_MAX_BIAS = 1;
/** Assessment 🔴: mean absolute error above this many labels… */
const ASSESS_BROKEN_MEAN_ERROR = 2;
/** …or any one session this far off (4 labels = two full rungs). */
const ASSESS_BROKEN_SESSION_ERROR = 4;
/** Conversation ✅: mean of the judge's product axes (1–5) at least this… */
const CONV_GOOD_MEAN = 4;
/** …no axis averaging below this… */
const CONV_GOOD_MIN_AXIS = 3;
/** …and at A1/A2, at most this % of questions not understood at all. */
const CONV_GOOD_MAX_NOT_UNDERSTOOD = 10;
/** Conversation 🔴: judge mean below this. */
const CONV_BROKEN_MEAN = 3;
/** Mean learner_fidelity below this flags the cell: the simulated learner, not the product, may be off. */
const FIDELITY_MIN = 3;

// ─── args ────────────────────────────────────────────────────────────────────

// --resume DIR reloads the options the run was started with (DIR/config.json); options given now override them.
const resume = cliArg("resume", "");
const rejudge = process.argv.includes("--rejudge");
const savedArgs: Record<string, string | true> =
  resume && existsSync(join(resume, "config.json")) ? JSON.parse(readFileSync(join(resume, "config.json"), "utf8")) : {};
const givenArgs: Record<string, string | true> = {};

function cliArg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fallback;
}
function arg(name: string, fallback: string): string {
  const v = cliArg(name, "");
  if (v) givenArgs[name] = v;
  const saved = savedArgs[name];
  return v || (typeof saved === "string" ? saved : fallback);
}
function flag(name: string): boolean {
  if (process.argv.includes(`--${name}`)) givenArgs[name] = true;
  return process.argv.includes(`--${name}`) || savedArgs[name] === true;
}

const ALL_LANGS: ConvLang[] = ["fr", "en", "nl-BE", "es", "it", "de"];
const languages = arg("lang", ALL_LANGS.join(",")).split(",").map((l) => l.trim()) as ConvLang[];
for (const l of languages) if (!isConvLang(l)) throw new Error(`Unknown language "${l}"`);
const levels = arg("levels", CEFR_LADDER.join(",")).split(",").map((l) => l.trim()) as CefrRung[];
for (const l of levels) if (!isCefrRung(l)) throw new Error(`Unknown level "${l}"`);
const runs = Number(arg("runs", "3"));
const startArg = arg("start", "");
if (startArg && !isCefrRung(startArg)) throw new Error("--start must be one of " + CEFR_LADDER.join(", "));
const stepArg = arg("step", "");
const fixed = arg("fixed", "");
const maxAnswers = Number(arg("max", "12"));
const useProxy = !flag("no-proxy");
const learnerProvider = arg("learner", "mistral") as SimConfig["learnerProvider"];
const judgeModel = arg("judge-model", "claude-sonnet-5-5");
const concurrency = Number(arg("concurrency", "4"));
const save = !flag("no-save");
const label = arg("label", "") || null;

const dir = resume || join("sim-runs", `matrix-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`);
/** Stored on every saved session as simulation_json.batchId. */
const batchId = dir.split("/").filter(Boolean).pop()!;
const sessionsDir = join(dir, "sessions");

muteConsole();
installMistralPacing();

// ─── conversation judge ──────────────────────────────────────────────────────

const JUDGE_AXES = ["level_fit", "adaptation", "naturalness", "target_language_quality", "closing"] as const;
type JudgeAxis = (typeof JUDGE_AXES)[number];

interface Judgement {
  scores: Record<JudgeAxis | "learner_fidelity", number>;
  issues: { axis: string; quote: string; problem: string }[];
  summary: string;
  model: string;
}

const JUDGE_SYSTEM = `You review one session of a spoken-language oral exam app. An AI examiner ("Léa") talks with a learner, adapting its questions on a CEFR difficulty ladder (A1…C2): each answer is judged and the next question goes up a rung, stays, or goes down. The session ends when the level has settled (min 5 answers). Learners are adults in Belgium.

Here the learner is SIMULATED by another AI at a known CEFR level. At A1/A2 the learner only "heard" part of each question (shown as "Learner heard", with "…" for what they missed). The rung tag on each question is the level the examiner was aiming at; ET is the per-answer pacing verdict and the rung it moved to.

Score the EXAMINER's side of the conversation, 1 (bad) to 5 (excellent):
- level_fit: were the questions pitched so this learner could show what they can do? Too hard (long, abstract, multi-part, idioms) or too easy for the whole session both lose points.
- adaptation: did the examiner simplify after a struggle or misunderstanding and raise the bar after easy, rich answers? Did the ladder settle near the learner's level, or yo-yo / run away?
- naturalness: does it feel like a good human examiner — one question at a time, brief reactions that show listening, relevant follow-ups, no repeated questions or topics, no lecturing?
- target_language_quality: is the examiner's own language correct, idiomatic and natural in the exam language (right register, no translation-ese, no mixing in other languages, no wrong words)?
- closing: did the session end cleanly and kindly, without a new question in the closing turn? (Score 3 if there is no closing turn shown.)

Also score learner_fidelity, 1–5: did the SIMULATED learner convincingly stay at its stated level throughout? This is a check on the test itself, not the product.

List concrete issues, each with a short verbatim quote. Do not invent issues; an empty list is fine.

Reply with JSON only:
{"scores":{"level_fit":n,"adaptation":n,"naturalness":n,"target_language_quality":n,"closing":n,"learner_fidelity":n},"issues":[{"axis":"…","quote":"…","problem":"…"}],"summary":"one or two sentences"}`;

function parseJudgement(raw: string): Omit<Judgement, "model"> {
  const json = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
  const p = JSON.parse(json);
  const scores = {} as Judgement["scores"];
  for (const k of [...JUDGE_AXES, "learner_fidelity"] as const) {
    const v = Number(p.scores?.[k]);
    if (!(v >= 1 && v <= 5)) throw new Error(`judge score ${k} missing or out of range`);
    scores[k] = v;
  }
  return { scores, issues: Array.isArray(p.issues) ? p.issues.slice(0, 8) : [], summary: String(p.summary ?? "") };
}

/**
 * The judge and analyst prefer Anthropic (a different vendor from the Mistral examiner/evaluator, so
 * not sharing their blind spots). Without a working Anthropic key they fall back to Mistral — the
 * report says which model judged.
 */
let anthropicUsable = !!process.env.ANTHROPIC_API_KEY;

async function reviewerComplete(system: string, user: string, maxTokens: number, context: string): Promise<{ text: string; model: string }> {
  if (anthropicUsable) {
    try {
      return { text: await getLlmProvider("anthropic").complete({ model: judgeModel, system, messages: [{ role: "user", content: user }], maxTokens, context }), model: judgeModel };
    } catch (e) {
      if (!/401|403|authentication|permission/i.test(String(e))) throw e;
      anthropicUsable = false;
      say("  Anthropic key rejected — judging with Mistral from now on.");
    }
  }
  const mistral = getLlmProvider("mistral");
  return { text: await mistral.complete({ model: mistral.modelLabel, system, messages: [{ role: "user", content: user }], maxTokens, context }), model: mistral.modelLabel };
}

async function judge(s: SessionRecord): Promise<Judgement | null> {
  if (!s.turns.length) return null;
  const user = `Exam language: ${s.language}. Simulated learner level: ${s.level}. Stop rule: ${s.stop ? `${s.stop.capped ? "hit the cap" : s.stop.decision.reason} after ${s.stop.turn} answers` : "fixed length"}.\n\n${transcriptText(s)}`;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const { text, model } = await reviewerComplete(JUDGE_SYSTEM, user, 1500, "sim-matrix-judge");
      return { ...parseJudgement(text), model };
    } catch (e) {
      if (attempt === 2) say(`  judge failed (${String(e).slice(0, 100)})`);
    }
  }
  return null;
}

// ─── playing ─────────────────────────────────────────────────────────────────

interface StoredSession {
  session: SessionRecord;
  judgement: Judgement | null;
  start: CefrRung;
  stepSize: number;
}

const fileFor = (lang: ConvLang, level: CefrRung, run: number) => join(sessionsDir, `${lang}-${level}-${run}.json`);

async function settingsFor(lang: ConvLang): Promise<{ start: CefrRung; stepSize: number }> {
  let live = { startingRung: "A2" as CefrRung, stepSize: 1 };
  if (!startArg || !stepArg) {
    try {
      live = await resolveConversationSettings(lang);
    } catch {
      // No database access — the hard-coded live fallback.
    }
  }
  return { start: (startArg || live.startingRung) as CefrRung, stepSize: stepArg ? Number(stepArg) : live.stepSize };
}

async function playAll() {
  mkdirSync(sessionsDir, { recursive: true });
  writeFileSync(join(dir, "config.json"), JSON.stringify({ ...savedArgs, ...givenArgs }, null, 2));
  const settings = new Map<ConvLang, { start: CefrRung; stepSize: number }>();
  for (const l of languages) settings.set(l, await settingsFor(l));

  // Round-robin: run 1 of every cell first, so a partial run still covers the grid.
  const jobs: { lang: ConvLang; level: CefrRung; run: number }[] = [];
  for (let run = 1; run <= runs; run++) for (const level of levels) for (const lang of languages) jobs.push({ lang, level, run });
  const todo = jobs.filter((j) => !existsSync(fileFor(j.lang, j.level, j.run)));
  say(
    `Matrix ${languages.join(",")} × ${levels.join(",")} × ${runs} → ${dir}\n` +
      `${todo.length} of ${jobs.length} sessions to play (${fixed ? `fixed ${fixed} answers` : `adaptive, max ${maxAnswers}`}, ${useProxy ? "audio proxy" : "text only"}, concurrency ${concurrency}, judge ${judgeModel})` +
      `\nStarting rungs: ${[...settings].map(([l, s]) => `${l} ${s.start}/step ${s.stepSize}`).join(", ")}`,
  );

  if (rejudge) {
    const stale = jobs.filter((j) => existsSync(fileFor(j.lang, j.level, j.run)));
    let n = 0;
    await runPool(stale, concurrency, async ({ lang, level, run }) => {
      const stored = JSON.parse(readFileSync(fileFor(lang, level, run), "utf8")) as StoredSession;
      if (stored.judgement?.model === judgeModel) return;
      const judgement = await judge(stored.session);
      if (judgement) writeFileSync(fileFor(lang, level, run), JSON.stringify({ ...stored, judgement }, null, 2));
      say(`  re-judged ${++n} · ${lang} ${level} #${run} · ${judgement?.model ?? "failed"}`);
    });
  }

  let done = 0;
  const t0 = Date.now();
  await runPool(todo, concurrency, async ({ lang, level, run }) => {
    const { start, stepSize } = settings.get(lang)!;
    const config: SimConfig = {
      language: lang, learnerLevel: level, startingRung: start, stepSize, learnerProvider,
      answers: fixed ? Number(fixed) : maxAnswers,
      ...(fixed ? {} : { lengthMode: "adaptive" as const, maxAnswers }),
      ...(useProxy ? { audioProxy: sampleAudioProxy(level) } : {}),
    };
    let session: SessionRecord;
    try {
      session = await playSession(config, { save, batchId, label });
    } catch (e) {
      session = emptySession(lang, level, String(e));
    }
    const judgement = await judge(session);
    const stored: StoredSession = { session, judgement, start, stepSize };
    // A session that never got a final level is kept out of the folder, so --resume retries it.
    if (session.finalLevel) writeFileSync(fileFor(lang, level, run), JSON.stringify(stored, null, 2));
    else writeFileSync(join(dir, `failed-${lang}-${level}-${run}-${Date.now()}.json`), JSON.stringify(stored, null, 2));
    done++;
    const eta = Math.round((((Date.now() - t0) / done) * (todo.length - done)) / 60000);
    say(
      `  ${done}/${todo.length} · ${lang} ${level} #${run} · ${session.turns.length} answers · rungs ${session.rungPath.join("→") || "—"} · ` +
        `final ${session.finalLevel ?? "FAILED"}${session.finalLevelTextOnly ? ` (text ${session.finalLevelTextOnly})` : ""}` +
        `${judgement ? ` · judge ${r1(mean(JUDGE_AXES.map((a) => judgement.scores[a])))}` : ""} · ~${eta} min left`,
    );
  });
}

// ─── grading ─────────────────────────────────────────────────────────────────

type Verdict = "good" | "needs_work" | "broken" | "no_data";
const ICON: Record<Verdict, string> = { good: "✅", needs_work: "🟠", broken: "🔴", no_data: "·" };
const RANK: Record<Verdict, number> = { no_data: -1, good: 0, needs_work: 1, broken: 2 };
const worse = (a: Verdict, b: Verdict) => (RANK[a] >= RANK[b] ? a : b);

interface Cell {
  language: ConvLang;
  level: CefrRung;
  sessions: number;
  verdict: Verdict;
  assessment: {
    verdict: Verdict;
    levels: string[];
    levelsTextOnly: string[];
    /** Mean signed error in labels (+ = over-estimates). */
    bias: number;
    meanAbsError: number;
    exactPct: number;
    withinOnePct: number;
    biasTextOnly: number | null;
    stopEstimates: string[];
    avgAnswers: number;
    reasons: string[];
  };
  conversation: {
    verdict: Verdict;
    judgeMean: number | null;
    axes: Partial<Record<JudgeAxis | "learner_fidelity", number>>;
    worstAxis: string | null;
    notUnderstoodPct: number | null;
    reasons: string[];
  };
  simUnreliable: boolean;
  metrics: Summary;
  issues: { run: number; axis: string; quote: string; problem: string }[];
  runs: (StoredSession & { run: number })[];
}

function gradeCell(language: ConvLang, level: CefrRung, stored: (StoredSession & { run: number })[]): Cell {
  const sessions = stored.map((s) => s.session);
  const target = levelIndex(level);
  const errs = sessions.map((s) => levelIndex(s.finalLevel) - target);
  const textErrs = sessions.filter((s) => s.finalLevelTextOnly).map((s) => levelIndex(s.finalLevelTextOnly) - target);
  const absErrs = errs.map(Math.abs);
  const bias = r1(mean(errs));
  const meanAbsError = r1(mean(absErrs));

  const aReasons: string[] = [];
  let aVerdict: Verdict = "no_data";
  if (sessions.length) {
    if (meanAbsError > ASSESS_BROKEN_MEAN_ERROR) aReasons.push(`off by ${meanAbsError} labels on average`);
    if (absErrs.some((e) => e >= ASSESS_BROKEN_SESSION_ERROR)) aReasons.push(`a session ${Math.max(...absErrs)} labels off`);
    if (aReasons.length) aVerdict = "broken";
    else if (absErrs.every((e) => e <= ASSESS_GOOD_MAX_ERROR) && Math.abs(bias) <= ASSESS_GOOD_MAX_BIAS) aVerdict = "good";
    else {
      aVerdict = "needs_work";
      if (absErrs.some((e) => e > ASSESS_GOOD_MAX_ERROR)) aReasons.push(`${absErrs.filter((e) => e > ASSESS_GOOD_MAX_ERROR).length}/${sessions.length} sessions more than ${ASSESS_GOOD_MAX_ERROR} label off`);
      if (Math.abs(bias) > ASSESS_GOOD_MAX_BIAS) aReasons.push(`${bias > 0 ? "over" : "under"}-estimates by ${Math.abs(bias)} labels`);
    }
  }

  const metrics = summarise(sessions, level);
  const judged = stored.map((s) => s.judgement).filter((j): j is Judgement => !!j);
  const axes: Cell["conversation"]["axes"] = {};
  for (const a of [...JUDGE_AXES, "learner_fidelity"] as const) if (judged.length) axes[a] = r1(mean(judged.map((j) => j.scores[a])));
  const productAxes = JUDGE_AXES.map((a) => axes[a]).filter((v): v is number => v !== undefined);
  const judgeMean = productAxes.length ? r1(mean(productAxes)) : null;
  const worstAxis = productAxes.length ? JUDGE_AXES.reduce((w, a) => ((axes[a] ?? 9) < (axes[w] ?? 9) ? a : w)) : null;
  const notUnderstoodPct = metrics.listening ? metrics.listening.notUnderstoodPct : null;

  const cReasons: string[] = [];
  let cVerdict: Verdict = "no_data";
  if (judgeMean !== null) {
    if (judgeMean < CONV_BROKEN_MEAN) {
      cVerdict = "broken";
      cReasons.push(`judge mean ${judgeMean}/5`);
    } else {
      const lowAxes = JUDGE_AXES.filter((a) => (axes[a] ?? 5) < CONV_GOOD_MIN_AXIS);
      if (judgeMean < CONV_GOOD_MEAN) cReasons.push(`judge mean ${judgeMean}/5`);
      if (lowAxes.length) cReasons.push(`low ${lowAxes.map((a) => `${a} ${axes[a]}`).join(", ")}`);
      if (notUnderstoodPct !== null && notUnderstoodPct > CONV_GOOD_MAX_NOT_UNDERSTOOD) cReasons.push(`${notUnderstoodPct}% of questions not understood`);
      cVerdict = cReasons.length ? "needs_work" : "good";
    }
  }

  return {
    language, level, sessions: sessions.length,
    verdict: worse(aVerdict, cVerdict),
    assessment: {
      verdict: aVerdict,
      levels: sessions.map((s) => s.finalLevel ?? "—"),
      levelsTextOnly: sessions.map((s) => s.finalLevelTextOnly ?? "—"),
      bias, meanAbsError,
      exactPct: metrics.finalLevel.exactPct,
      withinOnePct: metrics.finalLevel.withinOnePlusPct,
      biasTextOnly: textErrs.length ? r1(mean(textErrs)) : null,
      stopEstimates: sessions.map((s) => (s.stop ? `${s.stop.capped ? "cap" : s.stop.decision.estimatedLevel ?? "?"}@${s.stop.turn}` : "fixed")),
      avgAnswers: r1(mean(sessions.map((s) => s.turns.length))),
      reasons: aReasons,
    },
    conversation: { verdict: cVerdict, judgeMean, axes, worstAxis, notUnderstoodPct, reasons: cReasons },
    simUnreliable: axes.learner_fidelity !== undefined && axes.learner_fidelity < FIDELITY_MIN,
    metrics,
    issues: stored.flatMap((s) => (s.judgement?.issues ?? []).map((i) => ({ run: s.run, ...i }))),
    runs: stored,
  };
}

function loadCells(): Cell[] {
  const files = existsSync(sessionsDir) ? readdirSync(sessionsDir).filter((f) => f.endsWith(".json")) : [];
  const byCell = new Map<string, (StoredSession & { run: number })[]>();
  for (const f of files) {
    const m = f.match(/^(.+)-(A1|A2|B1|B2|C1|C2)-(\d+)\.json$/);
    if (!m) continue;
    const stored = JSON.parse(readFileSync(join(sessionsDir, f), "utf8")) as StoredSession;
    const key = `${m[1]}|${m[2]}`;
    byCell.set(key, [...(byCell.get(key) ?? []), { ...stored, run: Number(m[3]) }]);
  }
  // Grid axes: what was asked for, plus anything already in the folder (a resumed run may hold more).
  const langs = [...new Set([...languages, ...[...byCell.keys()].map((k) => k.split("|")[0] as ConvLang)])].sort((a, b) => ALL_LANGS.indexOf(a) - ALL_LANGS.indexOf(b));
  const lvls = [...new Set([...levels, ...[...byCell.keys()].map((k) => k.split("|")[1] as CefrRung)])].sort((a, b) => CEFR_LADDER.indexOf(a) - CEFR_LADDER.indexOf(b));
  return langs.flatMap((l) => lvls.map((lv) => gradeCell(l, lv, (byCell.get(`${l}|${lv}`) ?? []).sort((a, b) => a.run - b.run))));
}

// ─── analyst ─────────────────────────────────────────────────────────────────

const ANALYST_SYSTEM = `You are a language-assessment product analyst. A spoken oral exam app ("Léa", an AI examiner adapting its questions on a CEFR ladder, then a final CEFR evaluation) was tested with SIMULATED learners at known levels, in several languages. You get a language × level grid: per cell, the final levels obtained vs the true level, the per-session conversation-judge scores (1–5) and the issues the judge quoted.

Write a concise Markdown analysis for the developer:
1. **Verdict** — 3–4 sentences: where does the product work, where not?
2. **Patterns by level** — what goes wrong at which levels, across languages (with quoted evidence).
3. **Patterns by language** — what is specific to one language (examiner language quality, evaluator bias, question bank wording…).
4. **Assessment** — systematic over/under-estimation? Does the text-only level differ from the final one (audio-proxy dependence)? Does the stop rule's estimate agree with the evaluator?
5. **Recommended changes** — short prioritised list: the change, where it belongs (examiner prompt, question bank, ET, stop rule, evaluator prompt, scoring rules), the cells it should turn green.
6. **Caveats** — cells flagged "sim unreliable", small samples (few runs per cell).

Be specific and honest; do not pad.`;

async function runAnalysis(cells: Cell[]): Promise<string | null> {
  const compact = cells.filter((c) => c.sessions).map((c) => ({
    cell: `${c.language} ${c.level}`,
    verdict: c.verdict,
    assessment: { levels: c.assessment.levels, textOnly: c.assessment.levelsTextOnly, bias: c.assessment.bias, stop: c.assessment.stopEstimates, reasons: c.assessment.reasons },
    conversation: { judge: c.conversation.axes, notUnderstoodPct: c.conversation.notUnderstoodPct, reasons: c.conversation.reasons },
    simUnreliable: c.simUnreliable,
    issues: c.issues.slice(0, 6).map((i) => `[${i.axis}] “${i.quote}” — ${i.problem}`),
    judgeSummaries: c.runs.map((r) => r.judgement?.summary).filter(Boolean),
  }));
  try {
    const { text, model } = await reviewerComplete(ANALYST_SYSTEM, JSON.stringify(compact, null, 1), 4000, "sim-matrix-analysis");
    // Mistral tends to wrap the whole answer in a ```markdown fence.
    const body = text.trim().replace(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/, "$1");
    return `_Analyst: ${model}_\n\n${body}`;
  } catch (e) {
    say(`Analysis failed (${String(e).slice(0, 120)}) — report written without it.`);
    return null;
  }
}

// ─── reports ─────────────────────────────────────────────────────────────────

function gridAxes(cells: Cell[]) {
  const langs = [...new Set(cells.map((c) => c.language))];
  const lvls = [...new Set(cells.map((c) => c.level))];
  const at = (l: ConvLang, lv: CefrRung) => cells.find((c) => c.language === l && c.level === lv)!;
  return { langs, lvls, at };
}

function grid(cells: Cell[], render: (c: Cell) => string): string[] {
  const { langs, lvls, at } = gridAxes(cells);
  return [`| | ${lvls.join(" | ")} |`, `|---|${lvls.map(() => "---").join("|")}|`, ...langs.map((l) => `| **${l}** | ${lvls.map((lv) => render(at(l, lv))).join(" | ")} |`)];
}

function judgeModels(cells: Cell[]): string {
  const models = [...new Set(cells.flatMap((c) => c.runs.map((r) => r.judgement?.model).filter(Boolean)))];
  return models.join(" + ") || "none";
}

function renderMarkdown(cells: Cell[], analysis: string | null): string {
  const L: string[] = [];
  const played = cells.reduce((n, c) => n + c.sessions, 0);
  const count = (v: Verdict) => cells.filter((c) => c.verdict === v).length;
  L.push(`# Simulation matrix — ${played} sessions`, "");
  L.push(`${fixed ? `Fixed ${fixed} answers` : `Adaptive length (max ${maxAnswers})`} · ${useProxy ? "synthetic pronunciation/WPM (audio proxy)" : "text-only scoring"} · learner ${learnerProvider} · judge ${judgeModels(cells)} · folder \`${dir}\``, "");
  L.push(`**${count("good")} ✅ good · ${count("needs_work")} 🟠 needs work · ${count("broken")} 🔴 broken**${count("no_data") ? ` · ${count("no_data")} without data` : ""}`, "");

  L.push("## Overall", "", "Worse of the two grades below. ⚠ = the simulated learner drifted from its level (judge fidelity < 3) — read before blaming the product.", "");
  L.push(...grid(cells, (c) => `${ICON[c.verdict]}${c.simUnreliable ? " ⚠" : ""}`), "");

  L.push("## Assessment — was the final level right?", "", `Final levels per session (true level = column). ✅ every session within ±${ASSESS_GOOD_MAX_ERROR} label and |bias| ≤ ${ASSESS_GOOD_MAX_BIAS}; 🔴 mean error > ${ASSESS_BROKEN_MEAN_ERROR} labels or a session ≥ ${ASSESS_BROKEN_SESSION_ERROR} off. Bias in labels (A2→A2+ = +1).`, "");
  L.push(...grid(cells, (c) => (c.sessions ? `${ICON[c.assessment.verdict]} ${c.assessment.levels.join(" ")} (${c.assessment.bias > 0 ? "+" : ""}${c.assessment.bias})` : "·")), "");
  if (useProxy) {
    L.push("### Same answers, text-only evaluation (no audio proxy)", "", "The stricter test of the evaluator: the proxy is drawn from the true level.", "");
    L.push(...grid(cells, (c) => (c.sessions ? `${c.assessment.levelsTextOnly.join(" ")}${c.assessment.biasTextOnly !== null ? ` (${c.assessment.biasTextOnly > 0 ? "+" : ""}${c.assessment.biasTextOnly})` : ""}` : "·")), "");
  }
  if (!fixed) {
    L.push("### Stop rule — estimated level @ answers", "", ...grid(cells, (c) => (c.sessions ? c.assessment.stopEstimates.join(" ") : "·")), "");
  }

  L.push("## Conversation — was the exam right for this learner?", "", `Judge mean (1–5) over level_fit, adaptation, naturalness, target_language_quality, closing · weakest axis. ✅ mean ≥ ${CONV_GOOD_MEAN}, no axis < ${CONV_GOOD_MIN_AXIS}, at A1/A2 ≤ ${CONV_GOOD_MAX_NOT_UNDERSTOOD}% not understood; 🔴 mean < ${CONV_BROKEN_MEAN}.`, "");
  L.push(...grid(cells, (c) => (c.conversation.judgeMean !== null ? `${ICON[c.conversation.verdict]} ${c.conversation.judgeMean} · ${c.conversation.worstAxis} ${c.conversation.axes[c.conversation.worstAxis as JudgeAxis]}` : "·")), "");

  L.push("## Cells needing attention", "");
  const bad = cells.filter((c) => c.verdict === "needs_work" || c.verdict === "broken").sort((a, b) => RANK[b.verdict] - RANK[a.verdict]);
  if (!bad.length) L.push("None.", "");
  for (const c of bad) {
    L.push(`### ${ICON[c.verdict]} ${c.language} ${c.level}${c.simUnreliable ? " ⚠ sim unreliable" : ""}`, "");
    if (c.assessment.reasons.length) L.push(`- Assessment: ${c.assessment.reasons.join("; ")} — levels ${c.assessment.levels.join(", ")}`);
    if (c.conversation.reasons.length) L.push(`- Conversation: ${c.conversation.reasons.join("; ")}`);
    L.push(`- Rungs: ${c.runs.map((r) => r.session.rungPath.join("→")).join(" · ")}`);
    for (const i of c.issues.slice(0, 5)) L.push(`- [#${i.run} ${i.axis}] “${i.quote}” — ${i.problem}`);
    const probs = problemQuestions(c.runs.map((r) => r.session), 3);
    for (const p of probs) L.push(`- Not understood (${p.understanding}, ${p.rung}): “${p.question}”`);
    L.push("");
  }

  if (analysis) L.push("---", "", "## Analyst reading", "", analysis.trim(), "");
  L.push("---", "", "_Caveats: simulated learners (LLM), 1 LLM judge, few runs per cell. The audio proxy is drawn from the true level, so trust the text-only grid more for evaluator accuracy. Full transcripts: matrix.html or sessions/._");
  return L.join("\n") + "\n";
}

function renderHtml(cells: Cell[], analysis: string | null): string {
  const data = cells.map((c) => ({
    language: c.language, level: c.level, verdict: c.verdict, simUnreliable: c.simUnreliable,
    assessment: c.assessment, conversation: c.conversation, issues: c.issues,
    runs: c.runs.map((r) => ({
      run: r.run, start: r.start, persona: r.session.persona, finalLevel: r.session.finalLevel, finalLevelTextOnly: r.session.finalLevelTextOnly,
      score: r.session.finalScore, axes: r.session.axes, audio: r.session.audioProxy, stop: r.session.stop, summary: r.session.summary,
      judgement: r.judgement, turns: r.session.turns, closing: r.session.closing, errors: r.session.errors,
    })),
  }));
  const json = JSON.stringify({ data, analysis, levels: LEVEL_ORDER }).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Simulation Matrix</title>
<style>
:root{--bg:#fafaf9;--fg:#1c1917;--muted:#78716c;--card:#fff;--line:#e7e5e4;--good:#dcfce7;--good-fg:#166534;--work:#fef3c7;--work-fg:#92400e;--bad:#fee2e2;--bad-fg:#991b1b;--none:#f5f5f4;--accent:#2563eb}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0c0a09;--fg:#e7e5e4;--muted:#a8a29e;--card:#1c1917;--line:#292524;--good:#14532d;--good-fg:#bbf7d0;--work:#78350f;--work-fg:#fde68a;--bad:#7f1d1d;--bad-fg:#fecaca;--none:#1c1917;--accent:#60a5fa}}
:root[data-theme="dark"]{--bg:#0c0a09;--fg:#e7e5e4;--muted:#a8a29e;--card:#1c1917;--line:#292524;--good:#14532d;--good-fg:#bbf7d0;--work:#78350f;--work-fg:#fde68a;--bad:#7f1d1d;--bad-fg:#fecaca;--none:#1c1917;--accent:#60a5fa}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,-apple-system,sans-serif}
main{max-width:1200px;margin:0 auto;padding:24px 16px}h1{font-size:22px;margin:0 0 4px}.muted{color:var(--muted)}
.tabs{display:flex;gap:8px;margin:16px 0}.tabs button{border:1px solid var(--line);background:var(--card);color:var(--fg);padding:6px 12px;border-radius:6px;cursor:pointer}.tabs button.on{border-color:var(--accent);color:var(--accent)}
.wrap{overflow-x:auto}table.grid{border-collapse:separate;border-spacing:4px;min-width:640px}
.grid th{font-weight:600;padding:4px 8px;text-align:center}.grid td{border-radius:8px;padding:8px;min-width:110px;text-align:center;cursor:pointer;font-size:13px;border:2px solid transparent}
.grid td.sel{border-color:var(--accent)}.good{background:var(--good);color:var(--good-fg)}.needs_work{background:var(--work);color:var(--work-fg)}.broken{background:var(--bad);color:var(--bad-fg)}.no_data{background:var(--none);color:var(--muted)}
#detail{margin-top:20px;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px}
.run{border-top:1px solid var(--line);padding-top:12px;margin-top:12px}.turn{margin:8px 0;padding-left:10px;border-left:3px solid var(--line)}
.tag{display:inline-block;font-size:11px;padding:1px 6px;border-radius:4px;background:var(--none);color:var(--muted);margin-right:4px}
details summary{cursor:pointer;font-weight:600}pre{white-space:pre-wrap;font:inherit}
</style></head><body><main>
<h1>Simulation matrix</h1><div class="muted" id="sub"></div>
<div class="tabs" id="tabs"></div>
<div class="wrap"><table class="grid" id="grid"></table></div>
<div id="detail" class="muted">Click a cell for its sessions, judge notes and transcripts.</div>
<details style="margin-top:20px" id="an"><summary>Analyst reading</summary><pre id="analysis"></pre></details>
</main>
<script>
const {data,analysis,levels}=${json};
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const langs=[...new Set(data.map(c=>c.language))],lvls=[...new Set(data.map(c=>c.level))];
const views={overall:["Overall",c=>c.verdict,c=>(c.simUnreliable?"⚠ ":"")+({good:"Good",needs_work:"Needs work",broken:"Broken",no_data:"—"})[c.verdict]],
assessment:["Assessment",c=>c.assessment.verdict,c=>c.runs.length?esc(c.assessment.levels.join(" "))+"<br><small>bias "+c.assessment.bias+"</small>":"—"],
conversation:["Conversation",c=>c.conversation.verdict,c=>c.conversation.judgeMean!=null?c.conversation.judgeMean+"/5<br><small>"+esc(c.conversation.worstAxis)+"</small>":"—"]};
let view="overall",sel=null;
document.getElementById("sub").textContent=data.reduce((n,c)=>n+c.runs.length,0)+" sessions · "+["good","needs_work","broken"].map(v=>data.filter(c=>c.verdict===v).length+" "+v.replace("_"," ")).join(" · ");
if(analysis)document.getElementById("analysis").textContent=analysis;else document.getElementById("an").remove();
function draw(){
 document.getElementById("tabs").innerHTML=Object.entries(views).map(([k,[n]])=>'<button data-v="'+k+'" class="'+(k===view?"on":"")+'">'+n+"</button>").join("");
 document.querySelectorAll("#tabs button").forEach(b=>b.onclick=()=>{view=b.dataset.v;draw()});
 const [,cls,txt]=views[view];
 document.getElementById("grid").innerHTML="<tr><th></th>"+lvls.map(l=>"<th>"+l+"</th>").join("")+"</tr>"+langs.map(l=>"<tr><th>"+l+"</th>"+lvls.map(lv=>{const c=data.find(x=>x.language===l&&x.level===lv);return '<td class="'+cls(c)+(sel===c?" sel":"")+'" data-k="'+l+"|"+lv+'">'+txt(c)+"</td>"}).join("")+"</tr>").join("");
 document.querySelectorAll("#grid td").forEach(td=>td.onclick=()=>{const[l,lv]=td.dataset.k.split("|");sel=data.find(x=>x.language===l&&x.level===lv);draw();detail(sel)});
}
function detail(c){
 const d=document.getElementById("detail");d.classList.remove("muted");
 const a=c.assessment,v=c.conversation;
 d.innerHTML="<h2 style='margin:0'>"+esc(c.language+" · "+c.level)+(c.simUnreliable?" <span class='tag'>⚠ sim unreliable</span>":"")+"</h2>"+
 "<p><b>Assessment</b> ("+a.verdict+"): "+esc(a.levels.join(", "))+" · bias "+a.bias+" · text-only "+esc(a.levelsTextOnly.join(", "))+" · stop "+esc(a.stopEstimates.join(", "))+(a.reasons.length?"<br>"+esc(a.reasons.join("; ")):"")+"</p>"+
 "<p><b>Conversation</b> ("+v.verdict+"): "+Object.entries(v.axes).map(([k,x])=>esc(k)+" "+x).join(" · ")+(v.notUnderstoodPct!=null?" · not understood "+v.notUnderstoodPct+"%":"")+(v.reasons.length?"<br>"+esc(v.reasons.join("; ")):"")+"</p>"+
 c.runs.map(r=>"<div class='run'><details><summary>#"+r.run+" · "+esc(r.persona)+" · start "+r.start+" · final "+esc(r.finalLevel)+" ("+r.score+") · text-only "+esc(r.finalLevelTextOnly??"—")+(r.audio?" · proxy "+r.audio.wpm+" wpm / pron "+r.audio.pronunciation:"")+(r.judgement?" · judge "+Object.values(r.judgement.scores).join("/"):"")+"</summary>"+
  (r.judgement?"<p><i>"+esc(r.judgement.summary)+"</i></p><ul>"+r.judgement.issues.map(i=>"<li>["+esc(i.axis)+"] “"+esc(i.quote)+"” — "+esc(i.problem)+"</li>").join("")+"</ul>":"")+
  "<p class='muted'>Evaluator: "+esc(r.summary)+"</p>"+
  r.turns.map(t=>"<div class='turn'><span class='tag'>Q"+t.turn+" "+t.rung+"</span>"+(t.understanding?"<span class='tag'>heard: "+t.understanding+"</span>":"")+"<span class='tag'>ET "+esc(t.verdict)+"→"+esc(t.nextRung)+"</span><br><b>Léa:</b> "+esc(t.question)+(t.heard?"<br><span class='muted'>heard: "+esc(t.heard)+"</span>":"")+"<br><b>Learner:</b> "+esc(t.answer)+"</div>").join("")+
  (r.closing?"<div class='turn'><span class='tag'>closing</span><br><b>Léa:</b> "+esc(r.closing)+"</div>":"")+
  (r.errors.length?"<p class='muted'>Errors: "+esc(r.errors.join("; "))+"</p>":"")+"</details></div>").join("");
}
draw();
</script></body></html>
`;
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  await playAll();
  const cells = loadCells();
  if (!cells.some((c) => c.sessions)) throw new Error("No session produced a final level — check the API keys (.env.local).");
  say("Analysing…");
  const analysis = await runAnalysis(cells);
  const md = renderMarkdown(cells, analysis);
  writeFileSync(join(dir, "matrix.md"), md);
  writeFileSync(join(dir, "matrix.json"), JSON.stringify({ dir, cells, analysis }, null, 2));
  writeFileSync(join(dir, "matrix.html"), renderHtml(cells, analysis));
  restoreConsole();
  console.log(md);
  say(`\nSaved to ${dir}/ (matrix.md, matrix.html, matrix.json)`);
}

main().catch((e) => {
  restoreConsole();
  console.error(e);
  process.exit(1);
});
