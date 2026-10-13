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
 *   --no-save                    don't save the sessions to the database
 *   --label TEXT                 free-text tag stored on each saved session (e.g. "after step-up guard")

 * Each finished session is saved to the sessions table with source "simulation"
 * (same rows as a live session, no audio) and simulation_json.batchId = the
 * sim-runs/ folder name — filter Source = simulation in the admin sessions list,
 * and compare runs by batchId/label. Needs Supabase env vars and migration 0013.
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

import { type SimConfig } from "@/lib/conversation-sim";
import { isConvLang, type ConvLang } from "@/lib/conversation-prompts";
import { CEFR_LADDER, isCefrRung, type CefrRung } from "@/lib/cefr-rung";
import { getProvider as getLlmProvider } from "@/lib/llm/registry";
import {
  emptySession, installMistralPacing, muteConsole, playSession, problemQuestions, restoreConsole, runPool, say, summarise, transcriptText,
  type SessionRecord, type Summary,
} from "./lib/sim-core";

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
const save = !flag("no-save");
const label = arg("label", "") || null;
/** Also the sim-runs/ folder name — stored on every saved session as simulation_json.batchId. */
const batchId = `${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}-${level}`;

muteConsole();
installMistralPacing();

// ─── analyst ─────────────────────────────────────────────────────────────────

const ANALYST_SYSTEM = `You are a language-assessment product analyst. A spoken-language oral exam app ("Léa", an AI examiner) was tested with SIMULATED learners at a fixed CEFR level. You receive aggregate metrics, the questions the learner did not understand, and a few full transcripts. The goal: the exam must adapt its questions to the learner's real level, so they can show what they can do.

Write a concise analysis in Markdown for the developer, with these sections:
1. **Verdict** — 3-4 sentences: how well did the examiner adapt to this level? Is the final evaluation right?
2. **What went wrong** — concrete patterns, each backed by quoted examples from the data (question wording, rung path, verdicts). Look for: questions too long / abstract / multi-part for the level, the examiner not simplifying after a failure, the difficulty ladder climbing too fast or too slowly, repeated topics, level of the evaluation vs the simulated level.
3. **What worked** — brief.
4. **Recommended changes** — a short prioritised list. Each item: the change, where it likely belongs (examiner prompt rules, question bank wording, ET judging, starting rung/step size, evaluator prompt), and the metric that should move.
5. **Caveats** — how far these simulated-learner results can be trusted.

Be specific and honest; do not pad. If the data shows no problem in an area, say so.`;

async function runAnalysis(sessions: SessionRecord[], summary: Summary): Promise<string> {
  // Three transcripts: the best, the worst and a middle one by final score, so the analyst sees the spread.
  const ranked = sessions.filter((s) => s.turns.length).sort((a, b) => (a.finalScore ?? 0) - (b.finalScore ?? 0));
  const picks = [ranked[0], ranked[Math.floor(ranked.length / 2)], ranked[ranked.length - 1]].filter((s, i, a) => s && a.indexOf(s) === i);
  const user = `Simulated learner level: ${level}. Examiner starting rung: ${start}. Languages: ${languages.join(", ")}. ${answers} learner answers per session.

## Aggregate metrics
${JSON.stringify(summary, null, 2)}

## Questions the learner did not fully understand (worst first)
${JSON.stringify(problemQuestions(sessions, 20), null, 2)}

## Final evaluator summaries
${sessions.map((s) => `- ${s.finalLevel} (${s.finalScore}): ${s.summary ?? "—"}`).join("\n")}

## Full transcripts (lowest, middle, highest final score)
${picks.map(transcriptText).join("\n\n---\n\n")}`;
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

function renderReport(summary: Summary, sessions: SessionRecord[], analysis: string | null): string {
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
  let done = 0;
  await runPool(jobs, concurrency, async (language, i) => {
    const config: SimConfig = { language, learnerLevel: level as CefrRung, startingRung: start as CefrRung, stepSize, answers, learnerProvider };
    try {
      sessions[i] = await playSession(config, { save, batchId, label });
    } catch (e) {
      sessions[i] = emptySession(language, level as CefrRung, String(e));
    }
    say(`  ${++done}/${jobs.length} · ${sessions[i].language} · rungs ${sessions[i].rungPath.join("→") || "—"} · final ${sessions[i].finalLevel ?? "FAILED"}`);
  });

  const usable = sessions.filter((s) => s.turns.length);
  if (!usable.length) throw new Error("No session produced any turn — check the API keys (.env.local).");
  const summary = summarise(sessions, level as CefrRung);

  let analysis: string | null = null;
  if (analyse) {
    say("Analysing…");
    try {
      analysis = await runAnalysis(usable, summary);
    } catch (e) {
      say(`Analysis failed (${String(e)}) — report written with metrics only.`);
    }
  }

  const dir = join("sim-runs", batchId);
  mkdirSync(dir, { recursive: true });
  const report = renderReport(summary, sessions, analysis);
  writeFileSync(join(dir, "report.md"), report);
  writeFileSync(join(dir, "summary.json"), JSON.stringify(summary, null, 2));
  writeFileSync(join(dir, "sessions.json"), JSON.stringify(sessions, null, 2));
  restoreConsole();
  console.log(report);
  say(`\nSaved to ${dir}/` + (save ? ` — ${sessions.filter((x) => x.savedId).length}/${sessions.length} sessions saved to the database (source "simulation", batch ${batchId})` : ""));
}

main().catch((e) => {
  restoreConsole();
  console.error(e);
  process.exit(1);
});
