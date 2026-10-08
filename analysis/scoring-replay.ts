/**
 * Scoring replay — "what would this scoring change do to the sessions we
 * already have?" Reads stored sessions, re-scores them with the production
 * rules and with one or more what-if scenarios, and lists the sessions whose
 * level changes. No API calls, nothing is written to the database.
 *
 *   npm run analysis:scoring -- --scenario no-floor
 *   npm run analysis:scoring -- --scenario llm-base,bonus-8.5 --lang fr --since 2026-09-17
 *   npm run analysis:scoring -- --list
 *
 * Full guide: analysis/README.md
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
for (const f of [".env", ".env.local"]) if (existsSync(f)) process.loadEnvFile(f);
import { computeCompositeCefrScore, scoreToLevel } from "../lib/cefr-score";
import { loadSessionFacts } from "./lib/sessions";
import { PRODUCTION_RULES, scoreSession, type EvidenceSource, type ScoringRules } from "./lib/rules";
import { SCENARIOS } from "./scenarios";

const args = process.argv.slice(2);
const opt = (n: string, d?: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };

const LEVELS = ["A0", "A1", "A1+", "A2", "A2+", "B1", "B1+", "B2", "B2+", "C1", "C1+", "C2"];
const rank = (l: string) => { const i = LEVELS.indexOf(l); return i >= 0 ? i : LEVELS.indexOf(scoreToLevel(0)); };

function merge(names: string[]): ScoringRules {
  let rules: ScoringRules = { ...PRODUCTION_RULES, bonus: { ...PRODUCTION_RULES.bonus } };
  for (const n of names) {
    const s = SCENARIOS[n];
    if (!s) { console.error(`Unknown scenario "${n}". Run with --list.`); process.exit(1); }
    const { bonus, ...rest } = s.overrides;
    rules = { ...rules, ...rest, bonus: { ...rules.bonus, ...bonus } };
  }
  return rules;
}

async function main() {
  if (args.includes("--list")) {
    for (const [n, s] of Object.entries(SCENARIOS)) console.log(`${n.padEnd(14)} ${s.description}${s.ref ? `  [${s.ref}]` : ""}`);
    return;
  }
  const names = (opt("scenario") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  if (!names.length) { console.error("Pass --scenario <name[,name…]> (see --list)."); process.exit(1); }
  const rules = merge(names);
  const evidence = (opt("evidence", "stored") as EvidenceSource);

  const facts = await loadSessionFacts({
    since: opt("since"),
    lang: opt("lang"),
    source: opt("source", "conversation")!,
    limit: Number(opt("limit", "500")),
  });
  if (!facts.length) { console.log("No matching sessions."); return; }

  let baselineMatches = 0;
  const rows = facts.map((f) => {
    const before = scoreSession(f, PRODUCTION_RULES, evidence);
    const after = scoreSession(f, rules, evidence);
    // The replay's production rules must equal the live formula (what the results screen shows).
    const live = computeCompositeCefrScore(f.evaluation, f.pronunciation);
    const liveMirror = scoreSession(f, PRODUCTION_RULES, "stored");
    if (live.score === liveMirror.score && live.level === liveMirror.level) baselineMatches++;
    return { f, before, after, steps: rank(after.level) - rank(before.level) };
  });
  const changed = rows.filter((r) => r.after.level !== r.before.level);
  const up = changed.filter((r) => r.steps > 0).length;
  const down = changed.filter((r) => r.steps < 0).length;
  const bigJumps = changed.filter((r) => Math.abs(r.steps) > 2);

  const lines: string[] = [];
  lines.push(`# Scoring replay — ${names.join(" + ")}`, "");
  for (const n of names) lines.push(`- **${n}**: ${SCENARIOS[n].description}${SCENARIOS[n].ref ? ` _(${SCENARIOS[n].ref})_` : ""}`);
  lines.push("", `Sessions: ${rows.length} (source ${opt("source", "conversation")}${opt("lang") ? `, ${opt("lang")}` : ""}${opt("since") ? `, since ${opt("since")}` : ""})`);
  lines.push(`Baseline check: the replay's production rules equal the live formula (computeCompositeCefrScore) on ${baselineMatches}/${rows.length} sessions.${baselineMatches < rows.length ? " ⚠ MISMATCH — analysis/lib/rules.ts has drifted from lib/cefr-score.ts; fix that before trusting any result." : ""}`);
  if (evidence === "turns") lines.push("⚠ `--evidence turns`: answer counts / lengths are recomputed from the stored turns for ALL sessions, so \"Before\" shows what users WOULD have seen had the C2 floor existed for old sessions (it only applies to sessions evaluated since 2026-10-08).");
  lines.push("\"Before\" is the level users saw (evaluator score + bonus). The `cefr_level` column in the database is the evaluator's level before the bonus, so it can differ.");
  lines.push(`**${changed.length} of ${rows.length} sessions change level** (${up} up, ${down} down).${bigJumps.length ? ` ⚠ ${bigJumps.length} move by more than two steps — read those first.` : ""}`, "");
  lines.push("| Session | Lang | Date | Words/answer | Answers | Before | After | Why |", "|---|---|---|---|---|---|---|---|");
  for (const r of [...changed, ...rows.filter((x) => x.after.level === x.before.level)]) {
    const mark = r.after.level === r.before.level ? "=" : r.steps > 0 ? "↑" : "↓";
    lines.push(`| ${r.f.id.slice(0, 8)} | ${r.f.language ?? ""} | ${r.f.createdAt.slice(0, 10)} | ${r.f.turnEvidence.wordsPerAnswer.toFixed(0)} | ${r.f.turnEvidence.answers} | ${r.before.level} (${r.before.score}) | ${mark} ${r.after.level} (${r.after.score}) | ${r.after.notes.join("; ")} |`);
  }
  const report = lines.join("\n");

  console.log(report);
  mkdirSync("analysis/reports", { recursive: true });
  const file = `analysis/reports/scoring-replay-${names.join("+")}-${new Date().toISOString().slice(0, 16).replace(":", "-")}.md`;
  writeFileSync(file, report + "\n");
  console.log(`\nSaved to ${file}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
