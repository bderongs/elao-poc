/**
 * The overall level of the written test, computed in code — no LLM here.
 * Weighted average of the five criterion bands (lib/writing/grid.ts), then
 * the caps, each of which can only lower the level.
 */
import { CAPS, GRID } from "./grid";
import { CRITERIA, bandFromValue, bandValue, type AppliedCap, type Band, type Criterion, type CriterionBand, type TextSurvey } from "./types";

export interface WritingScore {
  level: Band;
  weightedAverage: number;
  uncappedLevel: Band;
  caps: AppliedCap[];
}

/**
 * Average → band, rounding halves DOWN ("en cas d'hésitation, la bande la
 * plus basse"): 3.5 → B1 (3), 3.51 → B2 (4).
 */
export function bandFromAverage(average: number): Band {
  return bandFromValue(Math.ceil(average - 0.5));
}

export function scoreWriting(criteria: Record<Criterion, CriterionBand>, surveys: TextSurvey[]): WritingScore {
  const totalWeight = CRITERIA.reduce((s, c) => s + GRID[c].weight, 0);
  const weightedAverage = CRITERIA.reduce((s, c) => s + bandValue(criteria[c].band) * GRID[c].weight, 0) / totalWeight;
  const uncappedLevel = bandFromAverage(weightedAverage);

  const caps: AppliedCap[] = [];
  let level = bandValue(uncappedLevel);
  const applyCap = (rule: AppliedCap["rule"], capValue: number, detail: string) => {
    if (level > capValue) {
      level = capValue;
      caps.push({ rule, cap: bandFromValue(capValue), detail });
    }
  };

  // Not intelligible without effort: too many passages the survey had to interpret.
  const words = surveys.reduce((s, x) => s + x.wordCount, 0);
  const interpreted = surveys.reduce((s, x) => s + x.interpretations.length, 0);
  const per100 = words > 0 ? (interpreted / words) * 100 : 0;
  if (per100 > CAPS.intelligibility.maxPer100Words) {
    applyCap(
      "intelligibility",
      bandValue(CAPS.intelligibility.cap),
      `${interpreted} passage(s) interprété(s) pour ${words} mots (${per100.toFixed(1)} pour 100 mots, seuil ${CAPS.intelligibility.maxPer100Words})`
    );
  }

  const task = bandValue(criteria.task_adequacy.band);
  applyCap("task_adequacy", task + CAPS.taskAdequacyMargin, `adéquation à la tâche : ${criteria.task_adequacy.band}`);

  const weakest = CRITERIA.reduce((min, c) => Math.min(min, bandValue(criteria[c].band)), Infinity);
  const weakestNames = CRITERIA.filter((c) => bandValue(criteria[c].band) === weakest).map((c) => GRID[c].label.fr);
  applyCap("weakest_criterion", weakest + CAPS.weakestCriterionMargin, `critère le plus bas : ${weakestNames.join(", ")} (${bandFromValue(weakest)})`);

  return { level: bandFromValue(level), weightedAverage: Math.round(weightedAverage * 100) / 100, uncappedLevel, caps };
}
