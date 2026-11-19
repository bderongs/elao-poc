/**
 * Runs the written test's evaluation end to end: survey of each text (pass 1,
 * in parallel), bands from the survey alone (pass 2), level in code. Nothing
 * is stored; the whole result is logged (event "writing_evaluation") so the
 * first runs can be reviewed for calibration.
 */
import { MISTRAL_LARGE_MODEL } from "@/lib/mistral";
import { logServerEvent } from "@/lib/server-log";
import { assignBands, BANDS_PROMPT_VERSION } from "./bands";
import { GRID_VERSION, WORD_LIMITS } from "./grid";
import { scoreWriting } from "./score";
import { surveyText, SURVEY_PROMPT_VERSION, type NotesLang } from "./survey";
import { WRITING_TASKS, countWords } from "./tasks";
import type { WritingLang, WritingResult } from "./types";

/** Both passes run on this model. MISTRAL_WRITING_MODEL overrides it. */
export function writingModel(): string {
  return process.env.MISTRAL_WRITING_MODEL ?? MISTRAL_LARGE_MODEL;
}

/** Why the texts cannot be evaluated, or null. Same limits as the page. */
export function invalidTexts(texts: unknown, language: WritingLang): string | null {
  const count = WRITING_TASKS[language].length;
  if (!Array.isArray(texts) || texts.length !== count || texts.some((t) => typeof t !== "string")) return `expected ${count} texts`;
  for (const [i, t] of (texts as string[]).entries()) {
    const n = countWords(t);
    if (n < WORD_LIMITS.min) return `text ${i + 1}: ${n} words, minimum ${WORD_LIMITS.min}`;
    if (n > WORD_LIMITS.max) return `text ${i + 1}: ${n} words, maximum ${WORD_LIMITS.max}`;
  }
  return null;
}

export async function evaluateWriting(params: { language: WritingLang; texts: string[]; notesLang: NotesLang }): Promise<WritingResult> {
  const { language, texts, notesLang } = params;
  const startedAt = Date.now();
  const model = writingModel();
  const tasks = WRITING_TASKS[language];

  const surveys = await Promise.all(
    tasks.map((task, i) => surveyText({ task, text: texts[i], textIndex: i, language, notesLang, model }))
  );
  const criteria = await assignBands({ tasks, surveys, language, notesLang, model });
  const score = scoreWriting(criteria, surveys);

  const result: WritingResult = {
    language,
    level: score.level,
    weightedAverage: score.weightedAverage,
    uncappedLevel: score.uncappedLevel,
    criteria,
    caps: score.caps,
    surveys,
    texts,
    meta: {
      model,
      promptVersion: `${SURVEY_PROMPT_VERSION}+${BANDS_PROMPT_VERSION}`,
      gridVersion: GRID_VERSION,
      durationMs: Date.now() - startedAt,
    },
  };
  logServerEvent("writing_evaluation", { result });
  return result;
}
