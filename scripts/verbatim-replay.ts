/**
 * A-02 — does replacing Deepgram change pronunciation scores?
 *
 * Re-scores stored user turns with the live pronunciation provider
 * (azure-ensemble) once per second-hearing engine (lib/pronunciation/
 * verbatim.ts), on the same audio, and compares turn and session averages.
 * Deepgram is re-run too: the gap between the stored score and the fresh
 * Deepgram score is the judge's own run-to-run noise, the yardstick for
 * reading the other gaps.
 *
 *   npx tsx scripts/verbatim-replay.ts                       # 2 sessions per language
 *   npx tsx scripts/verbatim-replay.ts --per-lang 3 --lang fr,de
 *   npx tsx scripts/verbatim-replay.ts --engines deepgram,voxtral-chat
 *
 * Writes sim-runs/verbatim-replay-<timestamp>.md. Read-only on the database.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
for (const f of [".env", ".env.local"]) if (existsSync(f)) process.loadEnvFile(f);

import { getSupabaseServer } from "../lib/supabase-server";
import { recordingPath } from "../lib/recordings";
import { azureEnsembleProvider } from "../lib/pronunciation/providers/azure-ensemble";
import { VERBATIM_ENGINES, type VerbatimEngine } from "../lib/pronunciation/verbatim";

const args = process.argv.slice(2);
const opt = (name: string, def?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const PER_LANG = Number(opt("per-lang", "2"));
const LANGS = (opt("lang", "fr,en,nl-BE,es,it,de") as string).split(",");
const ENGINES = (opt("engines", VERBATIM_ENGINES.join(",")) as string).split(",") as VerbatimEngine[];
const SINCE = opt("since", "2026-09-30");
const MAX_TURNS = Number(opt("max-turns", "6"));

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const r1 = (x: number) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : NaN);

type Row = { session: string; lang: string; turn: number; stored: number | null; scores: Partial<Record<VerbatimEngine, number>> };

async function main() {
  const sb = getSupabaseServer();
  const rows: Row[] = [];
  const out: string[] = [`# Verbatim-engine replay (A-02) — ${new Date().toISOString().slice(0, 16)}\n`, `Engines: ${ENGINES.join(", ")} · ${PER_LANG} sessions per language · up to ${MAX_TURNS} turns each\n`];

  for (const lang of LANGS) {
    const { data: sessions, error } = await sb
      .from("sessions").select("id, language, created_at").eq("language", lang).gte("created_at", SINCE)
      .or("source.is.null,source.neq.simulation").order("created_at", { ascending: false }).limit(PER_LANG * 4);
    if (error) throw error;
    let done = 0;
    for (const s of sessions ?? []) {
      if (done >= PER_LANG) break;
      const { data: turns } = await sb.from("session_turns").select("turn_index, role, content, audio_url, pronunciation_json").eq("session_id", s.id).order("turn_index");
      const user = (turns ?? []).filter((t) => t.role === "user" && t.audio_url && (t.content as string)?.trim().split(/\s+/).length >= 4).slice(0, MAX_TURNS);
      if (!user.length) continue;
      done++;
      console.log(`${lang} ${s.id.slice(0, 8)}: ${user.length} turns`);
      for (const t of user) {
        const path = recordingPath(t.audio_url as string);
        if (!path) continue;
        const { data: file } = await sb.storage.from("recordings").download(path);
        if (!file) continue;
        const audio = await file.arrayBuffer();
        const context = ((turns ?? []).filter((x) => x.role === "assistant" && x.turn_index < t.turn_index).pop()?.content as string) ?? "";
        const row: Row = { session: s.id.slice(0, 8), lang, turn: t.turn_index, stored: (t.pronunciation_json as { pronunciationScore?: number } | null)?.pronunciationScore ?? null, scores: {} };
        for (const engine of ENGINES) {
          const res = await azureEnsembleProvider.assess({ audio, contentType: "audio/wav; codecs=audio/pcm; samplerate=16000", langCode: lang, referenceText: t.content as string, context, verbatimEngine: engine }).catch(() => null);
          if (res) row.scores[engine] = res.pronunciationScore;
        }
        rows.push(row);
      }
    }
  }

  // Per-turn table
  out.push("\n## Turns\n", `| session | lang | turn | stored | ${ENGINES.join(" | ")} |`, `|---|---|---|---|${ENGINES.map(() => "---").join("|")}|`);
  for (const r of rows) out.push(`| ${r.session} | ${r.lang} | ${r.turn} | ${r.stored ?? "—"} | ${ENGINES.map((e) => r.scores[e] ?? "—").join(" | ")} |`);

  // Summary: mean score, mean |diff| vs fresh Deepgram, and vs stored (noise yardstick).
  const summarise = (subset: Row[], label: string) => {
    const line = [`**${label}** (${subset.length} turns)`];
    const noise = subset.filter((r) => r.stored != null && r.scores.deepgram != null).map((r) => Math.abs((r.stored as number) - (r.scores.deepgram as number)));
    line.push(`stored vs fresh Deepgram |Δ| ${r1(mean(noise))}`);
    for (const e of ENGINES) {
      const ok = subset.filter((r) => r.scores[e] != null);
      const m = mean(ok.map((r) => r.scores[e] as number));
      const vsDg = ok.filter((r) => r.scores.deepgram != null).map((r) => (r.scores[e] as number) - (r.scores.deepgram as number));
      line.push(`${e}: mean ${r1(m)}${e === "deepgram" ? "" : `, Δ vs Deepgram ${r1(mean(vsDg))} (|Δ| ${r1(mean(vsDg.map(Math.abs)))})`}`);
    }
    return "- " + line.join(" · ");
  };
  out.push("\n## Summary\n", summarise(rows, "all"), ...LANGS.map((l) => summarise(rows.filter((r) => r.lang === l), l)));

  // Session averages (what the level floors see).
  out.push("\n## Session averages\n", `| session | lang | stored | ${ENGINES.join(" | ")} |`, `|---|---|---|${ENGINES.map(() => "---").join("|")}|`);
  for (const id of [...new Set(rows.map((r) => r.session))]) {
    const rs = rows.filter((r) => r.session === id);
    out.push(`| ${id} | ${rs[0].lang} | ${r1(mean(rs.filter((r) => r.stored != null).map((r) => r.stored as number)))} | ${ENGINES.map((e) => r1(mean(rs.filter((r) => r.scores[e] != null).map((r) => r.scores[e] as number)))).join(" | ")} |`);
  }

  mkdirSync("sim-runs", { recursive: true });
  const file = `sim-runs/verbatim-replay-${new Date().toISOString().slice(0, 16).replace(":", "-")}.md`;
  writeFileSync(file, out.join("\n") + "\n");
  console.log(out.slice(out.indexOf("\n## Summary\n")).join("\n"));
  console.log(`\nWritten ${file}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
