/**
 * Boundary checks — a second opinion at the level boundary, by comparison
 * instead of an absolute score.
 *
 * The evaluator's 0–10 axes squeeze everyone toward the middle (calibration,
 * 2026-10-14): a native French speaker and a C1 English speaker both got ~9,
 * weak speakers ~7. Choosing which of two level descriptions fits better is
 * a much easier judgement for the model than placing a number. So once the
 * composite score gives a level, a judge compares the speaker with that
 * level's description and the next one up ("up") and the one below ("down"),
 * twice each; lib/cefr-score.ts moves the score only when both runs agree.
 *
 * Both checks are run and stored on the evaluation (boundary_checks), so the
 * scoring rules can try "up only" or "both ways" on the same data
 * (ScoringRules.boundaryCheck, npm run analysis:calibration -- --variants …).
 */
import type { LlmProvider } from "@/lib/llm/types";
import type { CefrResult } from "@/lib/types";

export const BOUNDARY_PROMPT_VERSION = "b1";

export const BASE_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
export type BaseLevel = (typeof BASE_LEVELS)[number];

/**
 * Spoken-language descriptions per level, paraphrasing the CEFR Companion
 * Volume scales that matter in an interview: overall spoken production and
 * interaction, range, accuracy, fluency, coherence, sociolinguistic control.
 */
export const LEVEL_DESCRIPTORS: Record<BaseLevel, string> = {
  A1: "Isolated words and memorised phrases about themselves and immediate needs. Long pauses to search for words; relies on the examiner rephrasing. Very limited control of a few simple structures.",
  A2: "Short, simple sentences on familiar, everyday topics (family, work, routine, likes), linked with 'and', 'but', 'because'. Basic vocabulary; systematic basic mistakes but the message is usually clear. Noticeable pauses and restarts; answers are short and need prompting to develop.",
  B1: "Keeps going comprehensibly on familiar topics, connecting ideas into a linear sequence; can narrate an experience and give brief reasons and explanations for opinions. Enough vocabulary for everyday topics with some circumlocution; reasonably accurate in familiar contexts, errors are noticeable but meaning is clear. Pauses for planning and repair, especially in longer stretches.",
  B2: "Clear, detailed descriptions and explanations on a wide range of topics, developing a viewpoint with relevant supporting points and some complex sentence forms. Good range for general and some abstract topics; few errors that cause misunderstanding, often self-corrected. Fairly even tempo; some hesitation when searching for expressions; interacts with ease.",
  C1: "Fluent, spontaneous, almost effortless expression; only a conceptually difficult subject can slow the natural flow. Broad lexical repertoire, including idioms, with occasional gaps filled by circumlocution. Consistently high grammatical accuracy, errors are rare and hard to spot. Well-structured, detailed answers on complex subjects; flexible, effective use of language for social and professional purposes.",
  C2: "Expresses themselves spontaneously, very fluently and precisely, conveying finer shades of meaning (qualifying, hedging, distinguishing close ideas) even on complex or abstract matters. Backtracks and restructures around a difficulty so smoothly the listener hardly notices. Consistent control of complex language; full command of idiomatic and colloquial language with awareness of connotation and register. The language of an educated native speaker speaking naturally — native spoken norms (dropped 'ne', contractions, fillers, colloquial register) are part of this, not errors.",
};

export const baseLevel = (level: string | null | undefined): BaseLevel | null => {
  const b = (level ?? "").replace(/\s*\(.*\)|\.\d+|\+/g, "").trim();
  return (BASE_LEVELS as readonly string[]).includes(b) ? (b as BaseLevel) : null;
};

export interface Exchange {
  question: string | null;
  answer: string;
}

/** One boundary: two adjacent levels, the judge's choice on each run. */
export interface BoundaryCheck {
  lower: BaseLevel;
  upper: BaseLevel;
  votes: ("lower" | "upper")[];
  /** "lower"/"upper" when every run agreed, otherwise "split". */
  decision: "lower" | "upper" | "split";
  /** A short justification per run, quoting the transcript. */
  reasons: string[];
}

export interface BoundaryChecks {
  version: string;
  /** The composite level the checks were run from. */
  from: BaseLevel;
  /** from vs. the level above — absent at C2. */
  up?: BoundaryCheck;
  /** The level below vs. from — absent at A1. */
  down?: BoundaryCheck;
}

const SYSTEM = `You are an experienced oral examiner (DALF / Cambridge level). You will read an interview transcript and decide which of TWO adjacent CEFR level descriptions fits the candidate's spoken performance better.

How to judge:
- Compare the WHOLE performance with both descriptions and pick the closer one. Do not average across topics: judge what the candidate shows on the most demanding questions they were asked. Easy questions cannot show the higher level, but they do not count against it either.
- The transcript comes from speech recognition: ignore odd words or missing small words that are plausibly recognition errors, and ignore punctuation.
- Native spoken norms (dropped "ne" in French, contractions, fillers, repetitions, colloquial register) are not errors.
- Quote the candidate to justify your choice.

Return ONLY JSON: {"choice": "lower" | "upper", "reason": "<one or two sentences quoting the transcript>"}`;

function userMessage(language: string, exchanges: Exchange[], lower: BaseLevel, upper: BaseLevel): string {
  const transcript = exchanges
    .map((e, i) => `${e.question ? `Examiner: ${e.question}\n` : ""}Candidate [${i + 1}]: ${e.answer}`)
    .join("\n\n");
  return `Language: ${language}

LOWER — ${lower}: ${LEVEL_DESCRIPTORS[lower]}

UPPER — ${upper}: ${LEVEL_DESCRIPTORS[upper]}

Transcript:
${transcript}

Which description fits the candidate better: "lower" (${lower}) or "upper" (${upper})?`;
}

async function checkBoundary(
  provider: LlmProvider,
  language: string,
  exchanges: Exchange[],
  lower: BaseLevel,
  upper: BaseLevel,
  runs: number,
  context: string,
): Promise<BoundaryCheck> {
  const results = await Promise.all(
    Array.from({ length: runs }, async () => {
      const raw = await provider.complete({
        model: provider.modelLabel,
        system: SYSTEM,
        messages: [{ role: "user", content: userMessage(language, exchanges, lower, upper) }],
        maxTokens: 400,
        json: true,
        context,
      });
      const parsed = JSON.parse(raw.replace(/^```json\s*|\s*```$/g, "").trim()) as { choice?: string; reason?: string };
      return { choice: parsed.choice === "upper" ? "upper" : "lower", reason: String(parsed.reason ?? "") } as const;
    }),
  );
  const votes = results.map((r) => r.choice);
  const decision = votes.every((v) => v === "upper") ? "upper" : votes.every((v) => v === "lower") ? "lower" : "split";
  return { lower, upper, votes, decision, reasons: results.map((r) => r.reason) };
}

/**
 * Runs both boundary checks around `level` (the composite level, see
 * lib/cefr-score.ts) and stamps them on the evaluation. Never throws: a
 * failed check is simply absent, and the score then stays as it was.
 */
export async function withBoundaryChecks(
  result: CefrResult,
  params: { provider: LlmProvider; language: string; exchanges: Exchange[]; level: string; runs?: number; context?: string },
): Promise<CefrResult> {
  const from = baseLevel(params.level);
  const answers = params.exchanges.filter((e) => e.answer.trim());
  if (!from || !answers.length) return result;
  const i = BASE_LEVELS.indexOf(from);
  const runs = params.runs ?? 2;
  const context = params.context ?? "cefr-boundary";
  const safe = (p: Promise<BoundaryCheck>) => p.catch((e) => { console.warn("[cefr-boundary] check failed:", e); return undefined; });
  const [up, down] = await Promise.all([
    i < BASE_LEVELS.length - 1 ? safe(checkBoundary(params.provider, params.language, answers, from, BASE_LEVELS[i + 1], runs, context)) : undefined,
    i > 0 ? safe(checkBoundary(params.provider, params.language, answers, BASE_LEVELS[i - 1], from, runs, context)) : undefined,
  ]);
  return { ...result, boundary_checks: { version: BOUNDARY_PROMPT_VERSION, from, ...(up ? { up } : {}), ...(down ? { down } : {}) } };
}

/** Question/answer pairs from a chat history: each candidate answer with the examiner turn just before it. */
export function exchangesFromHistory(history: { role: string; content: string }[]): Exchange[] {
  const out: Exchange[] = [];
  let question: string | null = null;
  for (const m of history) {
    if (m.role === "assistant") question = m.content;
    else if (m.role === "user") { out.push({ question, answer: m.content }); question = null; }
  }
  return out;
}
