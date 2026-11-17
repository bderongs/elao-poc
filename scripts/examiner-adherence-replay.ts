/**
 * Examiner adherence replay — does Léa do what the turn asks?
 *
 * Takes real recent conversations from the database, cuts each one after a
 * candidate answer, and replays ONE examiner turn on it per scenario, with the
 * same prompt the live route builds (lib/examiner-prompt.ts). Each reply is
 * scored automatically:
 *
 *   c1-ask    a C1 bank question is imposed  → was it asked?
 *   a1-ask    an A1 bank question is imposed → was it asked, and kept short?
 *   switch    a topic switch to a given domain (B1) → is the new question in that domain? (topic classifier)
 *   clarify   "didn't understand" (B1)        → same question, simpler: shorter and not the same words
 *   free      a plain B1 turn                  → hygiene only
 *
 * Hygiene on every reply: one question at most, no recap ("So you…"), no
 * filler praise, no leaked note, length, and which pivot it opens with.
 *
 * Random picks (bank question, pivot, slice) are seeded per context and
 * scenario, so two runs of the same code see the same turns — run it before
 * and after a prompt change and compare.
 *
 *   npx tsx scripts/examiner-adherence-replay.ts                              # en+fr, 6 sessions × 2 cuts, MISTRAL_CHAT_MODEL
 *   npx tsx scripts/examiner-adherence-replay.ts --models mistral-small-latest,mistral-large-2512 --lang en,fr,nl-BE --sessions 8
 *   npx tsx scripts/examiner-adherence-replay.ts --label before                # tag the output file
 *
 * Output: sim-runs/adherence-<label>-<timestamp>.json (every reply) and a summary table on stdout.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

for (const f of [".env", ".env.local"]) if (existsSync(f)) process.loadEnvFile(f);

type Msg = { role: "user" | "assistant"; content: string };

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

/** Deterministic Math.random for the duration of fn — mulberry32 seeded from a string. */
function seeded<T>(seed: string, fn: () => T): T {
  let h = 1779033703;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 3432918353);
  let a = h >>> 0;
  const original = Math.random;
  Math.random = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  try {
    return fn();
  } finally {
    Math.random = original;
  }
}

const norm = (s: string) => s.toLowerCase().normalize("NFC").replace(/[’‘]/g, "'").replace(/[^\p{L}\p{N}' ]+/gu, " ").replace(/\s+/g, " ").trim();
const contentWords = (s: string) => norm(s).split(" ").filter((w) => w.length > 3);
/** Share of the question's content words found in the reply. */
const coverage = (reply: string, q: string) => {
  const qw = contentWords(q);
  const rw = new Set(contentWords(reply));
  return qw.length ? qw.filter((w) => rw.has(w)).length / qw.length : 0;
};
const lastQuestion = (text: string) => {
  const sentences = text.split(/(?<=[.!?…])\s+/).map((s) => s.trim()).filter(Boolean);
  return [...sentences].reverse().find((s) => s.includes("?")) ?? sentences.at(-1) ?? "";
};
const wordCount = (s: string) => norm(s).split(" ").filter(Boolean).length;

const FILLER = /\b(great|wow|fantastic|interesting|perfect|excellent|wonderful|brilliant|super|génial|parfait|intéressant|excellent|formidable|geweldig|interessant|perfect|prima)\b/i;
const RECAP = /^(so,? you|so you|you mentioned|you said|vous avez dit|vous m'avez dit|donc vous|alors vous|u zei|dus u)/i;

async function main() {
  const { getSupabaseServer } = await import("@/lib/supabase-server");
  const { buildExaminerPrompt } = await import("@/lib/examiner-prompt");
  const { mistralComplete, mistralChatModel } = await import("@/lib/mistral");
  const { classifyTopicDomain } = await import("@/lib/topic-tracking");
  const { TOPIC_DOMAINS } = await import("@/lib/topic-domain");
  type Params = Parameters<typeof buildExaminerPrompt>[0];

  const models = (arg("models") ?? mistralChatModel()).split(",");
  const langs = (arg("lang") ?? "en,fr").split(",");
  const perLang = Number(arg("sessions") ?? 6) / langs.length;
  const label = arg("label") ?? "run";

  const db = getSupabaseServer();
  const { data, error } = await db
    .from("sessions")
    .select("id, language, transcript, created_at")
    .eq("source", "conversation")
    .in("language", langs)
    .not("transcript", "is", null)
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) throw error;
  type Row = { id: string; language: string; transcript: { role: string; content: string }[] };
  const usable = (data as Row[]).filter((s) => (s.transcript ?? []).filter((t) => t.role === "user" && t.content.split(" ").length > 12).length >= 4);
  const sessions = langs.flatMap((l) => usable.filter((s) => s.language === l).slice(0, Math.ceil(perLang)));
  console.log(`${sessions.length} sessions (${sessions.map((s) => s.language).join(",")}), models ${models.join(", ")}`);

  const rows: Record<string, unknown>[] = [];
  for (const s of sessions) {
    const t: Msg[] = s.transcript.map((x) => ({ role: x.role === "assistant" ? "assistant" : "user", content: x.content }));
    const answers = t.map((m, i) => (m.role === "user" && i > 0 ? i : -1)).filter((i) => i > 0);
    for (const cut of [answers[1], answers[3]].filter((x): x is number => x !== undefined)) {
      const history = t.slice(0, cut);
      const answer = t[cut].content;
      const lastExaminer = [...history].reverse().find((m) => m.role === "assistant")?.content ?? "";
      const language = s.language as Params["language"];
      const ctx = `${s.id}-${cut}`;
      const switchTo = TOPIC_DOMAINS[Math.abs([...ctx].reduce((h, c) => h * 31 + c.charCodeAt(0), 7)) % TOPIC_DOMAINS.length];
      const avoid = TOPIC_DOMAINS.find((d) => d !== switchTo)!;
      const scenarios: Record<string, Params> = {
        "c1-ask": { language, rung: "C1" },
        "a1-ask": { language, rung: "A1" },
        switch: { language, rung: "B1", avoidDomain: avoid, switchToDomain: switchTo },
        clarify: { language, rung: "B1", clarify: true },
        free: { language, rung: "B1" },
      };
      for (const [scenario, params] of Object.entries(scenarios)) {
        const built = seeded(`${ctx}:${scenario}`, () => buildExaminerPrompt(params)) as ReturnType<typeof buildExaminerPrompt> & { turnNote?: string };
        // The imposed question, read back from the prompt (system or turn note).
        const promptText = `${built.system}\n${built.turnNote ?? ""}`;
        const imposed = promptText.match(/(?:NEXT QUESTION|QUESTION TO ASK)[^\n]*\n"([^"]+)"/)?.[1] ?? null;
        const userContent = built.turnNote ? `${answer}\n\n${built.turnNote}` : answer;
        for (const model of models) {
          let reply = "";
          try {
            reply = (await mistralComplete({ model, system: built.system, messages: [...history, { role: "user", content: userContent }], maxTokens: 300, context: "adherence-replay" })).trim();
          } catch (e) {
            console.log("ERR", model, scenario, String(e).slice(0, 100));
            continue;
          }
          const q = lastQuestion(reply);
          const r: Record<string, unknown> = {
            session: s.id.slice(0, 8), language, cut, scenario, model, imposed, reply,
            questions: (reply.match(/\?/g) ?? []).length,
            words: wordCount(reply),
            questionWords: wordCount(q),
            filler: FILLER.test(reply),
            recap: RECAP.test(reply.trim()),
            leak: /INTERNAL|DIRECTION|\[|\]/.test(reply),
            pivot: reply.split(/[.,:!—]/)[0].trim().split(" ").length <= 4 ? reply.split(/[.,:!—]/)[0].trim() : "(none)",
          };
          if (imposed) {
            const cov = coverage(reply, imposed);
            r.asked = norm(reply).includes(norm(imposed)) || cov >= 0.6;
            r.verbatim = norm(reply).includes(norm(imposed));
          }
          if (scenario === "a1-ask") r.short = wordCount(q) <= 12;
          if (scenario === "clarify") {
            const prev = lastQuestion(lastExaminer);
            r.simpler = wordCount(q) < wordCount(prev) && wordCount(q) <= 12 && coverage(q, prev) < 0.75;
          }
          if (scenario === "switch") {
            const domain = await classifyTopicDomain({ questionAsked: q, turnLogId: "adherence", process: "adherence-replay" });
            r.target = switchTo;
            r.domain = domain;
            r.switched = domain === switchTo;
          }
          rows.push(r);
          const verdict = ["asked", "switched", "simpler"].map((k) => (k in r ? `${k}=${r[k] ? "yes" : "NO"}` : "")).join(" ").trim();
          console.log(`${model.padEnd(22)} ${scenario.padEnd(8)} ${language.padEnd(5)} ${verdict.padEnd(14)} | ${reply.replace(/\n/g, " ").slice(0, 110)}`);
          if (model.includes("large")) await new Promise((res) => setTimeout(res, 4000)); // 15 req/min on mistral-large-2512
        }
      }
    }
  }

  mkdirSync("sim-runs", { recursive: true });
  const out = `sim-runs/adherence-${label}-${new Date().toISOString().slice(0, 16).replace(/:/g, "-")}.json`;
  writeFileSync(out, JSON.stringify(rows, null, 1));

  const pct = (xs: Record<string, unknown>[], k: string) => {
    const ys = xs.filter((x) => k in x);
    return ys.length ? `${ys.filter((x) => x[k]).length}/${ys.length}` : "—";
  };
  console.log(`\n| model | scenario | n | asked | verbatim | short (A1) | switched | simpler | >1 question | recap | filler | leak | avg words | distinct pivots |`);
  console.log(`|---|---|---|---|---|---|---|---|---|---|---|---|---|---|`);
  for (const model of models) {
    for (const scenario of ["c1-ask", "a1-ask", "switch", "clarify", "free"]) {
      const xs = rows.filter((r) => r.model === model && r.scenario === scenario);
      if (!xs.length) continue;
      const multi = xs.filter((x) => (x.questions as number) > 1).length;
      const avg = (xs.reduce((a, x) => a + (x.words as number), 0) / xs.length).toFixed(1);
      const pivots = new Set(xs.map((x) => x.pivot)).size;
      console.log(`| ${model} | ${scenario} | ${xs.length} | ${pct(xs, "asked")} | ${pct(xs, "verbatim")} | ${pct(xs, "short")} | ${pct(xs, "switched")} | ${pct(xs, "simpler")} | ${multi} | ${xs.filter((x) => x.recap).length} | ${xs.filter((x) => x.filler).length} | ${xs.filter((x) => x.leak).length} | ${avg} | ${pivots} |`);
    }
  }
  console.log(`\nWritten ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
