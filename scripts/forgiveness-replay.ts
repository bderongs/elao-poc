/**
 * AD-06 (pronunciation part) — what would the recognition-forgiveness rule
 * (lib/recognition-forgiveness.ts) have changed on stored sessions? Re-applies
 * it to each user turn's stored word verdicts and prints old vs new session
 * pronunciation averages. No API calls. Uses the CURRENT settings in the file.
 *
 *   npx tsx scripts/forgiveness-replay.ts [--since 2026-09-17] [--lang en]
 */
import { existsSync } from "node:fs";
for (const f of [".env", ".env.local"]) if (existsSync(f)) process.loadEnvFile(f);
import { getSupabaseServer } from "../lib/supabase-server";
import { applyPronunciationForgiveness } from "../lib/recognition-forgiveness";

const args = process.argv.slice(2);
const opt = (n: string, d?: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };

async function main() {
  const sb = getSupabaseServer();
  let q = sb.from("sessions").select("id, language, created_at").gte("created_at", opt("since", "2026-09-17")!).order("created_at", { ascending: false }).limit(200);
  if (opt("lang")) q = q.eq("language", opt("lang")!);
  const { data: sessions } = await q;
  let changed = 0, total = 0;
  for (const s of sessions ?? []) {
    const { data: turns } = await sb.from("session_turns").select("turn_index, pronunciation_json").eq("session_id", s.id).eq("role", "user").order("turn_index");
    const scored = (turns ?? []).filter((t) => t.pronunciation_json?.words?.length && t.pronunciation_json.pronunciationScore > 0);
    if (!scored.length) continue;
    total++;
    let oldSum = 0, newSum = 0; const notes: string[] = [];
    for (const t of scored) {
      const pj = t.pronunciation_json;
      const f = applyPronunciationForgiveness(pj.words);
      const old = pj.pronunciationScore as number;
      const nw = f.score !== null ? Math.max(old, f.score) : old;
      oldSum += old; newSum += nw;
      if (f.score !== null) notes.push(`t${t.turn_index}: ${old}→${nw} (${f.forgivenIndices.map((i: number) => pj.words[i].word).join(", ")})`);
    }
    const o = oldSum / scored.length, n = newSum / scored.length;
    if (n > o + 0.05) changed++;
    console.log(`${s.id.slice(0, 8)} ${s.language} ${String(s.created_at).slice(0, 10)}  ${o.toFixed(1)} → ${n.toFixed(1)}  (${scored.length} turns)${notes.length ? "  " + notes.join("; ") : ""}`);
  }
  console.log(`\n${changed}/${total} sessions change`);
}
main();
