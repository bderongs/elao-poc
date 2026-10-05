/**
 * AD-01 — how often do the live transcript and Deepgram nova-3 disagree?
 *
 * For each stored conversation session with per-turn audio, re-runs Deepgram
 * on every user turn's WAV and aligns its words with the stored live
 * transcript (the one the evaluator and the pronunciation judge rate). Words
 * present in only one hearing, or heard differently, are "ASR-uncertain"
 * candidates for the joker mechanism (Track AD). Read the printed
 * disagreements by ear / by eye: are they really recognition errors, or real
 * speaker errors?
 *
 *   npx tsx scripts/asr-disagreement.ts                    # last 15 sessions
 *   npx tsx scripts/asr-disagreement.ts --limit 30 --lang fr
 *   npx tsx scripts/asr-disagreement.ts --session <uuid>   # one session
 *
 * Writes sim-runs/asr-disagreement-<timestamp>.md. Costs one Deepgram call per
 * user turn. Read-only on the database.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
for (const f of [".env", ".env.local"]) if (existsSync(f)) process.loadEnvFile(f);

import { getSupabaseServer } from "../lib/supabase-server";
import { deepgramVerbatim } from "../lib/pronunciation/providers/azure-ensemble";

const args = process.argv.slice(2);
const opt = (name: string, def?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const LIMIT = Number(opt("limit", "15"));
const LANG = opt("lang");
const SESSION = opt("session");
const SINCE = opt("since", "2026-09-30"); // current STT stack (Mistral realtime + VAD fix)

// Lower-case, strip punctuation / apostrophes / hyphens so "l'école" ≈ "l école".
const norm = (w: string) =>
  w.toLowerCase().normalize("NFC").replace(/[.,!?;:"«»()…]/g, "").replace(/[’'`-]/g, " ").trim();
const FILLERS = new Set(["eum", "euh", "uh", "um", "er", "eh", "ehm", "äh", "ähm", "eeh", "hm", "hmm", "mm"]);
// Digits vs spelled-out numbers ("300" / "three hundred") are formatting, not hearing.
const NUMBER_WORDS = new Set(("zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred thousand first second third " +
  "un deux trois quatre cinq six sept huit neuf dix onze douze treize quinze seize vingt trente quarante cinquante soixante cent mille " +
  "een twee drie vier vijf zes zeven acht negen tien twintig dertig veertig vijftig honderd duizend " +
  "uno dos tres cuatro cinco seis siete ocho nueve diez veinte treinta cuarenta cincuenta cien mil " +
  "due tre quattro sei sette otto nove dieci venti trenta quaranta cinquanta cento mille " +
  "eins zwei drei vier fünf sechs sieben acht neun zehn zwanzig dreißig vierzig fünfzig hundert tausend and et en y e und").split(" "));
const isNum = (w: string) => /\d/.test(w) || NUMBER_WORDS.has(w);
const tokens = (s: string) => norm(s).split(/\s+/).filter((w) => w && !FILLERS.has(w));

type Op = { kind: "same" | "sub" | "live-only" | "dg-only"; live?: string; dg?: string };

/** Word-level edit alignment (Levenshtein with backtrace). */
function align(a: string[], b: string[]): Op[] {
  const n = a.length, m = b.length;
  const d: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) d[i][0] = i;
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++)
      d[i][j] = Math.min(d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1), d[i - 1][j] + 1, d[i][j - 1] + 1);
  const ops: Op[] = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) {
      ops.push(a[i - 1] === b[j - 1] ? { kind: "same", live: a[i - 1], dg: b[j - 1] } : { kind: "sub", live: a[i - 1], dg: b[j - 1] });
      i--; j--;
    } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      ops.push({ kind: "live-only", live: a[i - 1] }); i--;
    } else {
      ops.push({ kind: "dg-only", dg: b[j - 1] }); j--;
    }
  }
  return ops.reverse();
}

async function main() {
  const sb = getSupabaseServer();
  let q = sb.from("sessions").select("id, language, created_at").order("created_at", { ascending: false }).limit(LIMIT * 3);
  if (SESSION) q = sb.from("sessions").select("id, language, created_at").eq("id", SESSION) as typeof q;
  if (!SESSION) q = q.gte("created_at", SINCE);
  if (LANG) q = q.eq("language", LANG);
  const { data: sessions, error } = await q;
  if (error) throw error;

  const out: string[] = ["# ASR disagreement — live transcript vs Deepgram nova-3\n"];
  let truncated = 0, headMissed = 0, subTotal = 0, totalWords = 0, totalDiff = 0, turnsDone = 0, sessionsDone = 0;
  const perLang: Record<string, { words: number; diff: number }> = {};

  for (const s of sessions ?? []) {
    if (sessionsDone >= LIMIT) break;
    const { data: turns } = await sb
      .from("session_turns")
      .select("turn_index, content, audio_url")
      .eq("session_id", s.id).eq("role", "user").not("audio_url", "is", null).order("turn_index");
    if (!turns?.length) continue;
    sessionsDone++;
    out.push(`\n## ${s.id.slice(0, 8)} · ${s.language} · ${String(s.created_at).slice(0, 16)}\n`);

    for (const t of turns) {
      let audio: ArrayBuffer;
      let contentType = "audio/wav";
      try {
        const res = await fetch(t.audio_url as string);
        if (!res.ok) { out.push(`- turn ${t.turn_index}: audio ${res.status}`); continue; }
        contentType = res.headers.get("content-type") ?? contentType;
        audio = await res.arrayBuffer();
      } catch (e) { out.push(`- turn ${t.turn_index}: audio fetch failed`); continue; }

      const dg = await deepgramVerbatim(audio, contentType, s.language === "nl" ? "nl-BE" : s.language);
      if (!dg) { out.push(`- turn ${t.turn_index}: Deepgram returned nothing`); continue; }
      turnsDone++;

      const live = tokens(t.content as string);
      const ops = align(live, tokens(dg.transcript));
      const diffs = ops.filter((o) => o.kind !== "same" && !((o.live && isNum(o.live)) || (o.dg && isNum(o.dg))));
      // Cut-off: a long run of Deepgram-only words at the very end / start = the live transcript missed it.
      const trail = (() => { let n = 0; for (let k = ops.length - 1; k >= 0 && ops[k].kind === "dg-only"; k--) n++; return n; })();
      const lead = (() => { let n = 0; for (let k = 0; k < ops.length && ops[k].kind === "dg-only"; k++) n++; return n; })();
      if (trail >= 4) { truncated++; }
      if (lead >= 3) { headMissed++; }
      const subs = diffs.filter((o) => o.kind === "sub").length;
      subTotal += subs;
      // Disagreement rate counted over live words (dg-only insertions counted too).
      totalWords += live.length;
      totalDiff += diffs.length;
      const pl = (perLang[s.language] ??= { words: 0, diff: 0 });
      pl.words += live.length; pl.diff += diffs.length;

      const rate = live.length ? Math.round((diffs.length / live.length) * 100) : 0;
      out.push(`\n**turn ${t.turn_index}** — ${live.length} words, ${diffs.length} differences (${rate}%)${trail >= 4 ? ` · ⚠ live transcript cut off (${trail} words missing at the end)` : ""}${lead >= 3 ? ` · ⚠ start missed (${lead} words)` : ""}`);
      out.push(`- live: ${t.content}`);
      out.push(`- deepgram: ${dg.transcript}`);
      if (diffs.length) {
        out.push("- differences: " + diffs.map((o) =>
          o.kind === "sub" ? `\`${o.live}\`→\`${o.dg}\`` : o.kind === "live-only" ? `\`${o.live}\`→∅` : `∅→\`${o.dg}\``
        ).join(", "));
      }
    }
  }

  const pct = (d: number, w: number) => (w ? Math.round((d / w) * 1000) / 10 : 0);
  const summary = [
    "\n---\n## Summary",
    `- ${sessionsDone} sessions, ${turnsDone} turns, ${totalWords} live words`,
    `- differences (numbers ignored): ${totalDiff} (${pct(totalDiff, totalWords)}% of live words), of which word-for-word substitutions: ${subTotal}`,
    `- turns where the live transcript is cut off at the end: ${truncated}/${turnsDone}; start missed: ${headMissed}/${turnsDone}`,
    ...Object.entries(perLang).map(([l, v]) => `- ${l}: ${v.diff}/${v.words} (${pct(v.diff, v.words)}%)`),
  ];
  out.splice(1, 0, ...summary, "");
  out.push(...summary);

  mkdirSync("sim-runs", { recursive: true });
  const file = `sim-runs/asr-disagreement-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16)}.md`;
  writeFileSync(file, out.join("\n"));
  console.log(summary.join("\n"));
  console.log(`\nReport: ${file}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
