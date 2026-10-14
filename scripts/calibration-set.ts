/**
 * Calibration set — real candidates with reference levels, to measure the oral
 * evaluation against (report: analysis/calibration.ts).
 *
 * The references come from the client's ELAO exports (one .xlsx per client,
 * kept out of git in doc/SpeechAce/ — they hold names and e-mails). For each
 * candidate they give the Speechace oral level ELAO derived ("Expression
 * orale") and ELAO's own levels from its other tests (global, grammar,
 * listening). Rows are matched to our Speechace imports by report id; only
 * levels and scores are stored (speechace_scores.reference), never identity.
 *
 *   npx tsx scripts/calibration-set.ts build [--dry-run] [--per-level 25] [--strong 25] [--dir doc/SpeechAce/…]
 *       Stores the reference on every imported session found in an export,
 *       then flags the calibration set: --per-level sessions per oral level
 *       A1–C1, plus --strong "C2" candidates (oral C2 first, then global C2),
 *       importing from Speechace the ones we don't have yet (audio included),
 *       and fetches the recordings of flagged sessions imported without them.
 *       Idempotent: sessions already flagged stay, the set is only topped up.
 *
 *   npx tsx scripts/calibration-set.ts score [--dry-run] [--concurrency 3] [--reevaluate]
 *       For each calibration session: our pronunciation on its recordings
 *       (the live provider for its language) when it has none, then the CEFR
 *       evaluation with the live model when it has none at the current
 *       CEFR_PROMPT_VERSION (--reevaluate: run it again anyway, e.g. once
 *       pronunciation arrived — the evaluator reads its score and speaking
 *       rate). Re-run after a prompt change to re-score.
 *
 *   npx tsx scripts/calibration-set.ts compare voxtral,azure-intended [--dry-run] [--concurrency 3]
 *       Runs other pronunciation engines on every calibration answer that has
 *       no run from them yet — comparison only: no rollup, the session's
 *       headline pronunciation and transcripts are left alone. The report
 *       then compares the engines (analysis/calibration.ts).
 *
 * WRITES to the shared database (sessions, session_turns, storage, eval rows)
 * and calls paid APIs (score) — unlike analysis/, which only reads.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
for (const f of [".env", ".env.local"]) if (existsSync(f)) process.loadEnvFile(f);
import { getSupabaseServer } from "../lib/supabase-server";
import { createSpeechaceImportSession, recomputeSessionRollup } from "../lib/sessions-service";
import { assessTurn } from "../lib/pronunciation/assess";
import { liveConversationPronunciationProviderId } from "../lib/pronunciation-rollup";
import { runCefrEvaluation, LIVE_CONVERSATION_MODEL_ID } from "../lib/cefr-eval";
import { CEFR_PROMPT_VERSION } from "../lib/cefr-prompt";
import type { SpeechaceReference, SpeechaceScores } from "../lib/types";

const args = process.argv.slice(2);
const opt = (n: string, d?: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const DRY = args.includes("--dry-run");
const sb = getSupabaseServer();

/** "B2 (75)", "C1.4", "A2" → "B2", "C1", "A2". */
const baseLevel = (l: string | null | undefined) => (l ? l.replace(/\s*\(.*\)|\.\d+/g, "").trim() : "");

// ─── Exports (.xlsx read with the system unzip — no dependency) ──────────────

function readXlsx(path: string): string[][] {
  const unzip = (entry: string) => { try { return execFileSync("unzip", ["-p", path, entry], { maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] }).toString("utf8"); } catch { return ""; } };
  const unescape = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  const shared = [...unzip("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => unescape([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")));
  const colIndex = (ref: string) => [...ref.replace(/\d+/g, "")].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
  return [...unzip("xl/worksheets/sheet1.xml").matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((row) => {
    const cells: string[] = [];
    for (const c of row[1].matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const [, ref, attrs, body = ""] = c;
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      const inline = /<t[^>]*>([\s\S]*?)<\/t>/.exec(body)?.[1];
      cells[colIndex(ref)] = /t="s"/.test(attrs) && v !== undefined ? shared[Number(v)] : unescape(inline ?? v ?? "");
    }
    return cells;
  });
}

interface ExportRow { report: string; url: string; ref: SpeechaceReference }

function loadExports(dir: string): Map<string, ExportRow> {
  const out = new Map<string, ExportRow>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".xlsx"))) {
    const client = file.replace(/^ELAO_evaluations_/, "").replace(/\.xlsx$/, "");
    const [header, ...rows] = readXlsx(join(dir, file));
    const col = (name: string) => header.indexOf(name);
    const num = (v: string | undefined) => (v === undefined || v === "" || isNaN(Number(v)) ? null : Number(v));
    for (const r of rows) {
      const url = r[col("Lien SpeechAce")] ?? "";
      const report = /\/report\/([a-f0-9]+)/.exec(url)?.[1];
      if (!report) continue;
      out.set(report, {
        report,
        url,
        ref: {
          client,
          oral_level: r[col("Expression orale - niveau")] || null,
          oral_pct: num(r[col("Expression orale - score (%)")]),
          global_level: r[col("Niveau global")] || null,
          grammar_level: r[col("Grammaire - niveau")] || null,
          listening_level: r[col("Compr. audition - niveau")] || null,
        },
      });
    }
    console.log(`${file}: ${rows.length} rows`);
  }
  return out;
}

// ─── Our sessions ────────────────────────────────────────────────────────────

interface ImportedSession { id: string; language: string; report: string | null; speechace_scores: SpeechaceScores | null; pronunciation_scores: unknown }

async function loadSpeechaceSessions(): Promise<ImportedSession[]> {
  const rows: ImportedSession[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("sessions")
      .select("id, language, source_url, speechace_scores, pronunciation_scores")
      .eq("source", "speechace")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []).map((r) => ({ ...r, report: /\/report\/([a-f0-9]+)/.exec(r.source_url ?? "")?.[1] ?? null }) as ImportedSession));
    if ((data ?? []).length < 1000) break;
  }
  return rows;
}

async function wordCounts(ids: string[]): Promise<Map<string, number>> {
  const words = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await sb.from("session_turns").select("session_id, content").in("session_id", ids.slice(i, i + 100)).eq("role", "user");
    if (error) throw new Error(error.message);
    for (const t of data ?? []) words.set(t.session_id, (words.get(t.session_id) ?? 0) + String(t.content ?? "").split(/\s+/).filter(Boolean).length);
  }
  return words;
}

async function setReference(id: string, scores: SpeechaceScores | null, ref: SpeechaceReference) {
  if (DRY) return;
  const { error } = await sb.from("sessions").update({ speechace_scores: { ...(scores ?? { fluency: null, pronunciation: null, overall: null }), reference: ref } }).eq("id", id);
  if (error) throw new Error(`${id}: ${error.message}`);
}

async function mapLimit<T>(items: T[], limit: number, fn: (t: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (next < items.length) await fn(items[next++]); }));
}

/** Stable pseudo-random order (FNV-1a of the report id), so the picked set doesn't change between runs. */
const stableKey = (s: string) => [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);

/** Enough speech to assess: an answer of a few words is not evidence of anything. */
const MIN_WORDS = 60;
const LEVEL_GROUPS = ["A1", "A2", "B1", "B2", "C1"];

const SPEECHACE = "https://speak.speechace.co/placement/api";
const SPEECHACE_HEADERS = { "User-Agent": "Mozilla/5.0", Accept: "application/json" };

/**
 * Sessions imported before the importer kept audio have turns without
 * audio_url, so our pronunciation can't run on them. Speechace still serves
 * the recordings: fetch each answer's audio (turn_index = the question's
 * position, as createSpeechaceImportSession numbers them) and attach it.
 */
async function attachMissingAudio(sessionIds: string[]) {
  let fixed = 0;
  await mapLimit(sessionIds, 4, async (id) => {
    const { data: session } = await sb.from("sessions").select("language, source_url").eq("id", id).single();
    const report = /\/report\/([a-f0-9]+)/.exec(session?.source_url ?? "")?.[1];
    const { data: turns } = await sb.from("session_turns").select("id, turn_index, audio_url").eq("session_id", id).eq("role", "user");
    const missing = (turns ?? []).filter((t) => !t.audio_url);
    if (!report || !missing.length) return;
    if (DRY) { fixed++; return; }
    try {
      const rep = await (await fetch(`${SPEECHACE}/report/${report}/`, { headers: SPEECHACE_HEADERS, signal: AbortSignal.timeout(20_000) })).json();
      const questions = ((rep.questions ?? []) as Array<{ order: number; question_attempt_id: number }>).slice().sort((a, b) => a.order - b.order);
      for (const t of missing) {
        const q = questions[t.turn_index];
        if (!q) continue;
        const res = await fetch(`${SPEECHACE}/question/attempt/${q.question_attempt_id}/audio/?token=${report}`, { headers: SPEECHACE_HEADERS, signal: AbortSignal.timeout(30_000) });
        if (!res.ok) continue;
        const path = `${session!.language}/calibration/${id}/turn-${t.turn_index}.wav`;
        const { error } = await sb.storage.from("recordings").upload(path, await res.blob(), { contentType: "audio/wav", upsert: true });
        if (error) continue;
        await sb.from("session_turns").update({ audio_url: sb.storage.from("recordings").getPublicUrl(path).data.publicUrl }).eq("id", t.id);
      }
      fixed++;
    } catch (e) {
      console.log(`audio fetch failed for ${id.slice(0, 8)}: ${e instanceof Error ? e.message : e}`);
    }
  });
  console.log(`recordings attached to ${fixed} calibration session(s) imported without them${DRY ? " (dry run)" : ""}`);
}

/**
 * recomputeSessionRollup replaces a Speechace session's answer text with our
 * pronunciation engine's transcript — noisier, and cut short on long answers.
 * The calibration measures the evaluator on Speechace's transcript (held
 * fixed), with our pronunciation score alongside: put Speechace's text back.
 */
async function restoreTranscripts(sessionIds: string[]) {
  let restored = 0, oursWords = 0, theirsWords = 0;
  const wc = (t: string) => t.split(/\s+/).filter(Boolean).length;
  await mapLimit(sessionIds, 4, async (id) => {
    const { data: session } = await sb.from("sessions").select("source_url").eq("id", id).single();
    const report = /\/report\/([a-f0-9]+)/.exec(session?.source_url ?? "")?.[1];
    if (!report) return;
    try {
      const rep = await (await fetch(`${SPEECHACE}/report/${report}/`, { headers: SPEECHACE_HEADERS, signal: AbortSignal.timeout(20_000) })).json();
      const questions = ((rep.questions ?? []) as Array<{ order: number; answer: string | null }>).slice().sort((a, b) => a.order - b.order);
      const { data: turns } = await sb.from("session_turns").select("id, turn_index, content").eq("session_id", id).eq("role", "user");
      for (const t of turns ?? []) {
        const answer = questions[t.turn_index]?.answer ?? "";
        if (!answer || answer === t.content) continue;
        oursWords += wc(t.content ?? "");
        theirsWords += wc(answer);
        restored++;
        if (!DRY) await sb.from("session_turns").update({ content: answer }).eq("id", t.id);
      }
    } catch (e) {
      console.log(`transcript restore failed for ${id.slice(0, 8)}: ${e instanceof Error ? e.message : e}`);
    }
  });
  if (restored) console.log(`Speechace transcript restored on ${restored} answer(s) — ours had ${oursWords} words, Speechace's ${theirsWords}${DRY ? " (dry run)" : ""}`);
}

async function build() {
  const dir = opt("dir", "doc/SpeechAce/reavancementettts")!;
  const perLevel = Number(opt("per-level", "25"));
  const strong = Number(opt("strong", "25"));
  const exports = loadExports(dir);
  console.log(`${exports.size} export rows with a Speechace report`);

  // 1. Reference on every imported session found in an export.
  const sessions = await loadSpeechaceSessions();
  const matched = sessions.filter((s) => s.report && exports.has(s.report));
  const words = await wordCounts(matched.map((s) => s.id));
  console.log(`${sessions.length} imported Speechace sessions, ${matched.length} found in the exports`);
  await mapLimit(matched, 8, async (s) => {
    const calibration = s.speechace_scores?.reference?.calibration;
    await setReference(s.id, s.speechace_scores, { ...exports.get(s.report!)!.ref, ...(calibration ? { calibration } : {}) });
  });

  // 2. The calibration set: keep what is flagged, top up each group.
  const flagged = new Set(matched.filter((s) => s.speechace_scores?.reference?.calibration).map((s) => s.report!));
  const inDb = new Map(matched.map((s) => [s.report!, s]));
  const toFlag: string[] = [];
  const toImport: string[] = [];
  const groupOf = (row: ExportRow) => {
    const oral = baseLevel(row.ref.oral_level);
    if (oral === "C2") return "C2";
    if (baseLevel(row.ref.global_level) === "C2") return "C2-global";
    return oral;
  };
  const rows = [...exports.values()].sort((a, b) => stableKey(a.report) - stableKey(b.report));
  const pick = (group: string, target: number, allowImport: boolean) => {
    const pool = rows.filter((r) => groupOf(r) === group);
    let have = pool.filter((r) => flagged.has(r.report)).length;
    // Sessions we hold with enough speech first — those with our pronunciation already scored before the others.
    const held = pool
      .filter((r) => !flagged.has(r.report) && inDb.has(r.report) && (words.get(inDb.get(r.report)!.id) ?? 0) >= MIN_WORDS)
      .sort((a, b) => Number(!!inDb.get(b.report)!.pronunciation_scores) - Number(!!inDb.get(a.report)!.pronunciation_scores));
    for (const r of held) { if (have >= target) break; toFlag.push(r.report); have++; }
    if (allowImport) for (const r of pool.filter((r) => !inDb.has(r.report))) { if (have >= target) break; toImport.push(r.report); have++; }
    return have;
  };
  const c2 = pick("C2", strong, true);
  pick("C2-global", strong - c2, true);
  for (const g of LEVEL_GROUPS) pick(g, perLevel, false);
  console.log(`calibration set: ${flagged.size} already flagged, ${toFlag.length} to flag, ${toImport.length} to import from Speechace${DRY ? " (dry run)" : ""}`);

  for (const report of toFlag) {
    const s = inDb.get(report)!;
    await setReference(s.id, s.speechace_scores, { ...exports.get(report)!.ref, calibration: true });
  }
  // 3. Recordings for flagged sessions imported without them, and Speechace's transcripts back where a rollup replaced them.
  const flaggedIds = [...matched.filter((s) => flagged.has(s.report!)), ...toFlag.map((r) => inDb.get(r)!)].map((s) => s.id);
  await restoreTranscripts(flaggedIds);
  await attachMissingAudio(flaggedIds);
  if (DRY) return;
  // 4. Import the missing ones (report + per-answer audio), then flag them.
  for (const report of toImport) {
    const row = exports.get(report)!;
    try {
      const { id, status } = await createSpeechaceImportSession(row.url);
      const { data } = await sb.from("sessions").select("speechace_scores").eq("id", id).single();
      await setReference(id, data?.speechace_scores ?? null, { ...row.ref, calibration: true });
      console.log(`imported ${id} (${status}) — ${row.ref.client}, oral ${row.ref.oral_level}, global ${row.ref.global_level}`);
    } catch (e) {
      console.log(`import failed for one ${row.ref.client} report: ${e instanceof Error ? e.message : e}`);
    }
  }
}

async function score() {
  const concurrency = Number(opt("concurrency", "3"));
  const { data: sessions, error } = await sb
    .from("sessions")
    .select("id, language, pronunciation_scores")
    .eq("source", "speechace")
    .eq("speechace_scores->reference->>calibration", "true");
  if (error) throw new Error(error.message);
  const { data: evals } = await sb
    .from("session_evaluations")
    .select("session_id")
    .in("session_id", (sessions ?? []).map((s) => s.id))
    .eq("model_id", LIVE_CONVERSATION_MODEL_ID)
    .eq("prompt_version", CEFR_PROMPT_VERSION)
    .not("result_json", "is", null);
  const evaluated = new Set(args.includes("--reevaluate") ? [] : (evals ?? []).map((e) => e.session_id));
  const needPron = (sessions ?? []).filter((s) => !s.pronunciation_scores);
  const needEval = (sessions ?? []).filter((s) => !evaluated.has(s.id));
  console.log(`${sessions?.length ?? 0} calibration sessions: ${needPron.length} need pronunciation, ${needEval.length} need an evaluation at prompt ${CEFR_PROMPT_VERSION}${DRY ? " (dry run)" : ""}`);
  if (DRY) return;

  let done = 0;
  await mapLimit(sessions ?? [], concurrency, async (s) => {
    try {
      if (!s.pronunciation_scores) {
        const { data: turns } = await sb.from("session_turns").select("id").eq("session_id", s.id).eq("role", "user").not("audio_url", "is", null);
        if (!turns?.length) console.log(`  ${s.id.slice(0, 8)}: no recordings — run build to attach them`);
        const provider = liveConversationPronunciationProviderId(s.language);
        for (const t of turns ?? []) await assessTurn(t.id, [provider]).catch((e) => console.log(`  ${s.id.slice(0, 8)} turn: ${e instanceof Error ? e.message : e}`));
        if (turns?.length) {
          await recomputeSessionRollup(s.id);
          await restoreTranscripts([s.id]);
        }
      }
      // After the pronunciation: the evaluator reads its score and speaking rate.
      if (!evaluated.has(s.id)) {
        const [row] = await runCefrEvaluation(s.id, [LIVE_CONVERSATION_MODEL_ID]);
        if (row?.error) throw new Error(row.error);
      }
      console.log(`[${++done}/${sessions!.length}] ${s.id.slice(0, 8)} ok`);
    } catch (e) {
      console.log(`[${++done}/${sessions!.length}] ${s.id.slice(0, 8)} FAILED: ${e instanceof Error ? e.message : e}`);
    }
  });
}

async function compare(providerIds: string[]) {
  const concurrency = Number(opt("concurrency", "3"));
  const { data: sessions, error } = await sb.from("sessions").select("id").eq("source", "speechace").eq("speechace_scores->reference->>calibration", "true");
  if (error) throw new Error(error.message);
  const { data: turns } = await sb.from("session_turns").select("id").in("session_id", (sessions ?? []).map((s) => s.id)).eq("role", "user").not("audio_url", "is", null);
  const turnIds = (turns ?? []).map((t) => t.id as string);
  const done = new Set<string>();
  for (let i = 0; i < turnIds.length; i += 200) {
    const { data } = await sb.from("session_turn_evaluations").select("turn_id, provider_id").in("turn_id", turnIds.slice(i, i + 200)).in("provider_id", providerIds).not("result_json", "is", null);
    for (const r of data ?? []) done.add(`${r.turn_id}|${r.provider_id}`);
  }
  const jobs = turnIds.flatMap((t) => providerIds.filter((p) => !done.has(`${t}|${p}`)).map((p) => ({ t, p })));
  console.log(`${turnIds.length} recorded answers × ${providerIds.join(", ")}: ${jobs.length} runs to do${DRY ? " (dry run)" : ""}`);
  if (DRY) return;
  let n = 0, failed = 0;
  await mapLimit(jobs, concurrency, async ({ t, p }) => {
    // A provider failure is stored as an error row, not thrown.
    try { const rows = await assessTurn(t, [p]); if (rows.some((r) => r.error || !r.result_json)) failed++; } catch { failed++; }
    if (++n % 50 === 0 || n === jobs.length) console.log(`[${n}/${jobs.length}] ${failed} failed`);
  });
}

const cmd = args[0];
(cmd === "build" ? build() : cmd === "score" ? score() : cmd === "compare" && args[1] ? compare(args[1].split(",")) : Promise.reject(new Error("usage: calibration-set.ts build|score|compare <providers> [options] — see the header")))
  .catch((e) => { console.error(e); process.exit(1); });
