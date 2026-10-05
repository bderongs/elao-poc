/**
 * Batch conversation simulation + analysis.
 *
 * Plays N simulated sessions (lib/conversation-sim.ts — the real examiner
 * prompt, ET, TT and final CEFR evaluation, against an LLM learner at a fixed
 * level), computes per-turn / per-session metrics in code, then asks an
 * analyst LLM to read the results and say what was too hard or off.
 *
 *   npx tsx scripts/sim-batch.ts --level A1 --lang fr --runs 10
 *   npx tsx scripts/sim-batch.ts --level C1 --lang fr,en --runs 6 --start C1 --answers 8
 *
 * Options (all optional):
 *   --level A1|A2|B1|B2|C1|C2   learner level to simulate        (A1)
 *   --lang  fr,en,nl-BE,es,it,de languages, comma-separated      (fr)
 *   --runs  N                    sessions per language           (10)
 *   --answers N                  learner answers per session     (7)
 *   --start RUNG                 examiner starting rung          (A2 = live default)
 *   --step N                     ET step size                    (1)
 *   --learner mistral|anthropic  who plays the learner           (mistral)
 *   --concurrency N              sessions in parallel            (4)
 *   --no-analysis                skip the analyst LLM call (metrics only)
 *
 * Mistral is paced globally to ~26 requests/minute (this key's limit is 30),
 * so 10 sessions take roughly 12-15 minutes whatever --concurrency is.
 *
 * Output: sim-runs/<timestamp>-<level>/ with report.md, summary.json and
 * sessions.json (full transcripts + events). Costs real LLM calls (examiner,
 * ET, TT, learner, listener, evaluator per session) — keep --runs modest.
 *
 * Caveat: the simulated learner is an LLM; at A1/A2 a separate "listening"
 * call degrades what it hears, which is what makes it useful here, but it is
 * still a model of a beginner, not a beginner. Use it to compare changes and
 * find clear problems, not as ground truth. No audio: pronunciation is not
 * evaluated and fluency is judged from text only.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

for (const f of [".env", ".env.local"]) if (existsSync(f)) process.loadEnvFile(f);

import { runConversationSimulation, type SimConfig, type SimEvent, type Understanding } from "@/lib/conversation-sim";
import { isConvLang, type ConvLang } from "@/lib/conversation-prompts";
import { CEFR_LADDER, isCefrRung, type CefrRung } from "@/lib/cefr-rung";
import { getProvider as getLlmProvider } from "@/lib/llm/registry";

// ─── args ────────────────────────────────────────────────────────────────────

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fallback;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const level = arg("level", "A1");
const start = arg("start", "A2");
if (!isCefrRung(level) || !isCefrRung(start)) throw new Error("--level and --start must be one of " + CEFR_LADDER.join(", "));
const languages = arg("lang", "fr").split(",").map((l) => l.trim());
for (const l of languages) if (!isConvLang(l)) throw new Error(`Unknown language "${l}"`);
const runsPerLang = Number(arg("runs", "10"));
const answers = Number(arg("answers", "7"));
const stepSize = Number(arg("step", "1"));
const learnerProvider = arg("learner", "mistral") as SimConfig["learnerProvider"];
const concurrency = Number(arg("concurrency", "4"));
const analyse = !flag("no-analysis");

// ─── console noise: the lib logs every LLM call, mute it and print our own progress ──

const realLog = console.log;
const realInfo = console.info;
const realWarn = console.warn;
const realError = console.error;
console.log = () => {};
console.info = () => {};
console.warn = () => {};
console.error = () => {};
const say = (msg: string) => process.stderr.write(msg + "\n");

// ─── Mistral pacing ──────────────────────────────────────────────────────────
// Mistral allows ~30 requests/minute on this key and a session makes ~35 LLM
// calls, so parallel sessions blow through it (the lib's own 3 quick retries
// don't outlast a 429 window and the session dies). Every request to Mistral
// goes through one global slot scheduler (≈ 26/min), and a 429 waits and retries.

const MIN_GAP_MS = Number(process.env.SIM_MISTRAL_GAP_MS ?? 2300);
let nextSlot = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.includes("api.mistral.ai")) return realFetch(input, init);
  for (let attempt = 1; ; attempt++) {
    const now = Date.now();
    const slot = Math.max(now, nextSlot);
    nextSlot = slot + MIN_GAP_MS;
    if (slot > now) await new Promise((r) => setTimeout(r, slot - now));
    const res = await realFetch(input, init);
    if (res.status !== 429 || attempt >= 6) return res;
    await new Promise((r) => setTimeout(r, 15000 * attempt));
  }
}) as typeof fetch;

// ─── types ───────────────────────────────────────────────────────────────────

interface TurnRecord {
  turn: number;
  /** Rung the examiner targeted for this question. */
  rung: CefrRung;
  question: string;
  questionWords: number;
  questionMarks: number;
  understanding: Understanding | null; // null above A2 (no listening simulation)
  heard: string | null;
  answer: string;
  answerWords: number;
  verdict: string | null;
  nextRung: CefrRung | null;
}

interface SessionRecord {
  language: ConvLang;
  persona: string;
  turns: TurnRecord[];
  rungPath: CefrRung[];
  finalLevel: string | null;
  finalScore: number | null;
  axes: { fluency: number | null; vocabulary_grammar: number | null; communication: number | null } | null;
  confidence: string | null;
  summary: string | null;
  errors: string[];
  durationMs: number;
}

// ─── one session ─────────────────────────────────────────────────────────────

async function playSession(language: ConvLang): Promise<SessionRecord> {
  const config: SimConfig = { language, learnerLevel: level as CefrRung, startingRung: start as CefrRung, stepSize, answers, learnerProvider };
  const rec: SessionRecord = {
    language, persona: "", turns: [], rungPath: [], finalLevel: null, finalScore: null,
    axes: null, confidence: null, summary: null, errors: [], durationMs: 0,
  };
  // The examiner event for turn N is the question the learner answers in turn N+1.
  let pending: { rung: CefrRung; text: string } | null = null;
  let current: TurnRecord | null = null;

  for await (const e of runConversationSimulation(config) as AsyncGenerator<SimEvent>) {
    switch (e.type) {
      case "start":
        rec.persona = `${e.persona.name}, ${e.persona.age}, ${e.persona.job}`;
        break;
      case "examiner":
        if (!e.closing) {
          pending = { rung: e.rung, text: e.text };
          rec.rungPath.push(e.rung);
        }
        break;
      case "learner": {
        if (!pending) break;
        current = {
          turn: e.turn,
          rung: pending.rung,
          question: pending.text,
          questionWords: pending.text.split(/\s+/).filter(Boolean).length,
          questionMarks: (pending.text.match(/\?/g) ?? []).length,
          understanding: e.understanding ?? null,
          heard: e.heard ?? null,
          answer: e.text,
          answerWords: e.text.split(/\s+/).filter(Boolean).length,
          verdict: null,
          nextRung: null,
        };
        rec.turns.push(current);
        break;
      }
      case "et":
        if (current && current.turn === e.turn) {
          current.verdict = e.verdict;
          current.nextRung = e.nextRung;
        }
        break;
      case "evaluation": {
        const r = e.result;
        rec.finalLevel = e.composite.level;
        rec.finalScore = e.composite.score;
        rec.axes = { fluency: r.dimensions.fluency, vocabulary_grammar: r.dimensions.vocabulary_grammar, communication: r.dimensions.communication };
        rec.confidence = r.confidence;
        rec.summary = r.summary;
        break;
      }
      case "error":
        rec.errors.push(`${e.stage}: ${e.message}`);
        break;
      case "done":
        rec.durationMs = e.durationMs;
        break;
    }
  }
  return rec;
}

// ─── metrics ─────────────────────────────────────────────────────────────────

const LEVEL_ORDER = ["A0", "A1", "A1+", "A2", "A2+", "B1", "B1+", "B2", "B2+", "C1", "C1+", "C2"];
const levelIndex = (l: string | null) => (l ? LEVEL_ORDER.indexOf(l) : -1);
/** Expected label for the simulated level: the plain rung (e.g. "A1"); ±1 label ("A1+", "A0") counts as close. */
const targetIdx = LEVEL_ORDER.indexOf(level);

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
const r1 = (n: number) => Math.round(n * 10) / 10;

function percentile(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

function summarise(sessions: SessionRecord[]) {
  const turns = sessions.flatMap((s) => s.turns);
  const listened = turns.filter((t) => t.understanding !== null);
  const count = (u: Understanding) => listened.filter((t) => t.understanding === u).length;
  const firstTurns = sessions.map((s) => s.turns[0]).filter(Boolean);
  const firstListened = firstTurns.filter((t) => t.understanding !== null);

  const verdicts = turns.filter((t) => t.verdict);
  const byRung = CEFR_LADDER.map((rung) => {
    const ts = turns.filter((t) => t.rung === rung);
    const lt = ts.filter((t) => t.understanding !== null);
    return {
      rung,
      questions: ts.length,
      notFullyUnderstood: lt.length ? pct(lt.filter((t) => t.understanding !== "full").length, lt.length) : null,
      avgQuestionWords: r1(mean(ts.map((t) => t.questionWords))),
    };
  }).filter((r) => r.questions > 0);

  const scored = sessions.filter((s) => s.finalLevel);
  const idx = scored.map((s) => levelIndex(s.finalLevel));
  const within = (n: number) => pct(idx.filter((i) => Math.abs(i - targetIdx) <= n).length, scored.length);
  const maxRung = (s: SessionRecord) => Math.max(...s.rungPath.map((r) => CEFR_LADDER.indexOf(r)));
  const targetRungIdx = CEFR_LADDER.indexOf(level as CefrRung);

  return {
    sessions: sessions.length,
    failedSessions: sessions.filter((s) => s.errors.length || !s.finalLevel).length,
    turns: turns.length,
    listening: listened.length
      ? {
          fullyUnderstoodPct: pct(count("full"), listened.length),
          partialPct: pct(count("partial"), listened.length),
          notUnderstoodPct: pct(count("none"), listened.length),
          firstQuestionNotFullyUnderstoodPct: pct(firstListened.filter((t) => t.understanding !== "full").length, firstListened.length),
          sessionsWithAnyNone: pct(sessions.filter((s) => s.turns.some((t) => t.understanding === "none")).length, sessions.length),
        }
      : null,
    questions: {
      avgWords: r1(mean(turns.map((t) => t.questionWords))),
      p90Words: percentile(turns.map((t) => t.questionWords), 90),
      over12WordsPct: pct(turns.filter((t) => t.questionWords > 12).length, turns.length),
      multiQuestionPct: pct(turns.filter((t) => t.questionMarks > 1).length, turns.length),
    },
    answers: { avgWords: r1(mean(turns.map((t) => t.answerWords))) },
    pacing: {
      verdicts: {
        well: pct(verdicts.filter((t) => t.verdict === "well").length, verdicts.length),
        adequate: pct(verdicts.filter((t) => t.verdict === "adequate").length, verdicts.length),
        struggled: pct(verdicts.filter((t) => t.verdict === "struggled").length, verdicts.length),
      },
      avgMaxRungReached: r1(mean(sessions.map((s) => (s.rungPath.length ? maxRung(s) : 0))) - targetRungIdx) + " rungs above the simulated level",
      sessionsReachingTwoAboveLevelPct: pct(sessions.filter((s) => s.rungPath.length && maxRung(s) >= targetRungIdx + 2).length, sessions.length),
    },
    byRung,
    finalLevel: {
      distribution: Object.fromEntries(LEVEL_ORDER.map((l) => [l, scored.filter((s) => s.finalLevel === l).length]).filter(([, n]) => (n as number) > 0)),
      avgScore: r1(mean(scored.map((s) => s.finalScore ?? 0))),
      exactPct: within(0),
      withinOnePlusPct: within(1),
      withinTwoPct: within(2),
      avgAxes: scored.length
        ? {
            fluency: r1(mean(scored.map((s) => s.axes?.fluency ?? 0))),
            vocabulary_grammar: r1(mean(scored.map((s) => s.axes?.vocabulary_grammar ?? 0))),
            communication: r1(mean(scored.map((s) => s.axes?.communication ?? 0))),
          }
        : null,
    },
  };
}

/** Questions the learner did not (fully) understand, worst first, with what they actually heard. */
function problemQuestions(sessions: SessionRecord[], limit = 25) {
  const rank = (u: Understanding | null) => (u === "none" ? 2 : u === "partial" ? 1 : 0);
  return sessions
    .flatMap((s) => s.turns.map((t) => ({ language: s.language, ...t })))
    .filter((t) => rank(t.understanding) > 0)
    .sort((a, b) => rank(b.understanding) - rank(a.understanding) || b.questionWords - a.questionWords)
    .slice(0, limit)
    .map((t) => ({ rung: t.rung, understanding: t.understanding, words: t.questionWords, question: t.question, heard: t.heard, answer: t.answer }));
}

// ─── analyst ─────────────────────────────────────────────────────────────────

const ANALYST_SYSTEM = `You are a language-assessment product analyst. A spoken-language oral exam app ("Léa", an AI examiner) was tested with SIMULATED learners at a fixed CEFR level. You receive aggregate metrics, the questions the learner did not understand, and a few full transcripts. The goal: the exam must adapt its questions to the learner's real level, so they can show what they can do.

Write a concise analysis in Markdown for the developer, with these sections:
1. **Verdict** — 3-4 sentences: how well did the examiner adapt to this level? Is the final evaluation right?
2. **What went wrong** — concrete patterns, each backed by quoted examples from the data (question wording, rung path, verdicts). Look for: questions too long / abstract / multi-part for the level, the examiner not simplifying after a failure, the difficulty ladder climbing too fast or too slowly, repeated topics, level of the evaluation vs the simulated level.
3. **What worked** — brief.
4. **Recommended changes** — a short prioritised list. Each item: the change, where it likely belongs (examiner prompt rules, question bank wording, ET judging, starting rung/step size, evaluator prompt), and the metric that should move.
5. **Caveats** — how far these simulated-learner results can be trusted.

Be specific and honest; do not pad. If the data shows no problem in an area, say so.`;

async function runAnalysis(sessions: SessionRecord[], summary: ReturnType<typeof summarise>): Promise<string> {
  // Three transcripts: the best, the worst and a middle one by final score, so the analyst sees the spread.
  const ranked = sessions.filter((s) => s.turns.length).sort((a, b) => (a.finalScore ?? 0) - (b.finalScore ?? 0));
  const picks = [ranked[0], ranked[Math.floor(ranked.length / 2)], ranked[ranked.length - 1]].filter((s, i, a) => s && a.indexOf(s) === i);
  const transcript = (s: SessionRecord) =>
    `### ${s.language} · ${s.persona} · final ${s.finalLevel} (${s.finalScore}) · rungs ${s.rungPath.join("→")}\n` +
    s.turns
      .map((t) => `[Q${t.turn} · ${t.rung} · understood: ${t.understanding ?? "n/a"} · ET: ${t.verdict ?? "?"}→${t.nextRung ?? "?"}]\nExaminer: ${t.question}\n${t.heard ? `Learner heard: ${t.heard}\n` : ""}Learner: ${t.answer}`)
      .join("\n\n");
  const user = `Simulated learner level: ${level}. Examiner starting rung: ${start}. Languages: ${languages.join(", ")}. ${answers} learner answers per session.

## Aggregate metrics
${JSON.stringify(summary, null, 2)}

## Questions the learner did not fully understand (worst first)
${JSON.stringify(problemQuestions(sessions, 20), null, 2)}

## Final evaluator summaries
${sessions.map((s) => `- ${s.finalLevel} (${s.finalScore}): ${s.summary ?? "—"}`).join("\n")}

## Full transcripts (lowest, middle, highest final score)
${picks.map(transcript).join("\n\n---\n\n")}`;
  // Prefer a vendor other than the Mistral examiner; fall back to Mistral if that key is missing or rejected.
  const ids = process.env.ANTHROPIC_API_KEY ? (["anthropic", "mistral"] as const) : (["mistral"] as const);
  let lastError: unknown;
  for (const id of ids) {
    try {
      const provider = getLlmProvider(id);
      const text = await provider.complete({ model: provider.modelLabel, system: ANALYST_SYSTEM, messages: [{ role: "user", content: user }], maxTokens: 2500, context: "sim-batch-analysis" });
      return `_Analyst: ${provider.modelLabel}_\n\n${text}`;
    } catch (e) {
      lastError = e;
      say(`  analyst "${id}" failed (${String(e).slice(0, 80)})${id !== ids[ids.length - 1] ? " — trying next" : ""}`);
    }
  }
  throw lastError;
}

// ─── report ──────────────────────────────────────────────────────────────────

function renderReport(summary: ReturnType<typeof summarise>, sessions: SessionRecord[], analysis: string | null): string {
  const L: string[] = [];
  L.push(`# Simulation batch — learner ${level}, ${sessions.length} sessions`, "");
  L.push(`Languages: ${languages.join(", ")} · examiner starts at ${start} · ET step ${stepSize} · ${answers} answers/session · learner: ${learnerProvider}`, "");
  if (summary.failedSessions) L.push(`> ⚠ ${summary.failedSessions} session(s) failed or got no evaluation — see sessions.json.`, "");
  L.push("## Headline", "");
  L.push(`- Final level exactly "${level}": **${summary.finalLevel.exactPct}%** · within one "+"/band: **${summary.finalLevel.withinOnePlusPct}%** · within two: ${summary.finalLevel.withinTwoPct}%`);
  L.push(`- Distribution: ${Object.entries(summary.finalLevel.distribution).map(([l, n]) => `${l}×${n}`).join(", ")} · avg score ${summary.finalLevel.avgScore}`);
  if (summary.listening) {
    L.push(`- Questions fully understood: **${summary.listening.fullyUnderstoodPct}%** (partial ${summary.listening.partialPct}%, not understood ${summary.listening.notUnderstoodPct}%) · first question not fully understood in ${summary.listening.firstQuestionNotFullyUnderstoodPct}% of sessions · ${summary.listening.sessionsWithAnyNone}% of sessions had at least one question not understood at all`);
  }
  L.push(`- Question length: avg ${summary.questions.avgWords} words, p90 ${summary.questions.p90Words}, >12 words in ${summary.questions.over12WordsPct}% of questions, several question marks in ${summary.questions.multiQuestionPct}%`);
  L.push(`- Pacing judge verdicts: well ${summary.pacing.verdicts.well}% · adequate ${summary.pacing.verdicts.adequate}% · struggled ${summary.pacing.verdicts.struggled}%`);
  L.push(`- Highest rung reached averages ${summary.pacing.avgMaxRungReached}; ${summary.pacing.sessionsReachingTwoAboveLevelPct}% of sessions reached 2+ rungs above the learner`);
  if (summary.finalLevel.avgAxes) L.push(`- Average axes (0-10): fluency ${summary.finalLevel.avgAxes.fluency}, vocab/grammar ${summary.finalLevel.avgAxes.vocabulary_grammar}, communication ${summary.finalLevel.avgAxes.communication}`);
  L.push("", "## By rung asked", "", "| Rung | Questions | Not fully understood | Avg words |", "|---|---|---|---|");
  for (const r of summary.byRung) L.push(`| ${r.rung} | ${r.questions} | ${r.notFullyUnderstood === null ? "n/a" : r.notFullyUnderstood + "%"} | ${r.avgQuestionWords} |`);
  L.push("", "## Sessions", "", "| # | Lang | Persona | Rungs asked | Final | Score | F / V&G / C |", "|---|---|---|---|---|---|---|");
  sessions.forEach((s, i) =>
    L.push(`| ${i + 1} | ${s.language} | ${s.persona} | ${s.rungPath.join("→")} | ${s.finalLevel ?? "—"} | ${s.finalScore ?? "—"} | ${s.axes ? `${s.axes.fluency} / ${s.axes.vocabulary_grammar} / ${s.axes.communication}` : "—"} |`),
  );
  const problems = problemQuestions(sessions, 15);
  if (problems.length) {
    L.push("", "## Questions the learner did not fully understand", "");
    for (const p of problems) L.push(`- **${p.rung}** · ${p.understanding} · ${p.words} words — “${p.question}”${p.heard ? ` → heard “${p.heard}”` : ""}`);
  }
  if (analysis) L.push("", "---", "", "## Analyst reading", "", analysis.trim());
  return L.join("\n") + "\n";
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  const jobs: ConvLang[] = languages.flatMap((l) => Array(runsPerLang).fill(l as ConvLang));
  say(`Playing ${jobs.length} sessions (learner ${level}, start ${start}, ${answers} answers, concurrency ${concurrency})…`);
  const sessions: SessionRecord[] = new Array(jobs.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const i = next++;
      try {
        sessions[i] = await playSession(jobs[i]);
      } catch (e) {
        sessions[i] = { language: jobs[i], persona: "", turns: [], rungPath: [], finalLevel: null, finalScore: null, axes: null, confidence: null, summary: null, errors: [String(e)], durationMs: 0 };
      }
      say(`  ${++done}/${jobs.length} · ${sessions[i].language} · rungs ${sessions[i].rungPath.join("→") || "—"} · final ${sessions[i].finalLevel ?? "FAILED"}`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));

  const usable = sessions.filter((s) => s.turns.length);
  if (!usable.length) throw new Error("No session produced any turn — check the API keys (.env.local).");
  const summary = summarise(sessions);

  let analysis: string | null = null;
  if (analyse) {
    say("Analysing…");
    try {
      analysis = await runAnalysis(usable, summary);
    } catch (e) {
      say(`Analysis failed (${String(e)}) — report written with metrics only.`);
    }
  }

  const dir = join("sim-runs", `${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}-${level}`);
  mkdirSync(dir, { recursive: true });
  const report = renderReport(summary, sessions, analysis);
  writeFileSync(join(dir, "report.md"), report);
  writeFileSync(join(dir, "summary.json"), JSON.stringify(summary, null, 2));
  writeFileSync(join(dir, "sessions.json"), JSON.stringify(sessions, null, 2));
  console.log = realLog;
  console.info = realInfo;
  console.warn = realWarn;
  console.error = realError;
  console.log(report);
  say(`\nSaved to ${dir}/`);
}

main().catch((e) => {
  console.log = realLog;
  console.error = realError;
  console.error(e);
  process.exit(1);
});
