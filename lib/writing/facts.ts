/**
 * Departure counts per text, computed in code from the survey's facts — the
 * evidence for "no error recorded" that no single excerpt can carry. Pure
 * (no server import): the results screen uses it too.
 */
import { FACT_CATEGORIES, type FactCategory, type TextSurvey } from "./types";

/** Survey id of a text's departure counts: "T2-D". */
export function countsId(textIndex: number): string {
  return `T${textIndex + 1}-D`;
}

export function departureCounts(survey: TextSurvey): { total: number; byCategory: Record<FactCategory, number> } {
  const byCategory = Object.fromEntries(FACT_CATEGORIES.map((c) => [c, 0])) as Record<FactCategory, number>;
  for (const f of survey.facts) if (f.departure) byCategory[f.category]++;
  return { total: survey.facts.filter((f) => f.departure).length, byCategory };
}

/** "spelling 0, punctuation 1, …" — every category, zeros included (a zero is evidence). */
export function departureCountsLine(survey: TextSurvey): string {
  const { total, byCategory } = departureCounts(survey);
  const per100 = survey.wordCount ? Math.round((total / survey.wordCount) * 1000) / 10 : 0;
  return `${total} departure(s) in ${survey.wordCount} words (${per100} per 100 words) — ${FACT_CATEGORIES.map((c) => `${c} ${byCategory[c]}`).join(", ")}`;
}
