/**
 * Topic-domain type + guard, split out the same way lib/cefr-rung.ts is
 * split from lib/level-assessment.ts — so app/page.tsx (client) can import
 * the type/labels without pulling in server-only deps. The domains are the
 * granularity at which topic-breadth is tracked: conversation-prompts.ts's
 * REALISM rule used to ask the model to self-count "how many turns in a row
 * on the same subject" purely in prose, which proved unreliable across
 * several live sessions (e.g. staying on "Paris" for 6+ turns despite the
 * rule capping it at 2) — the same failure mode the codebase already hit
 * and fixed for difficulty pacing (see lib/level-assessment.ts's ET). This
 * file backs the same fix applied to topic breadth: lib/topic-tracking.ts's
 * small classifier tags each question asked, app/page.tsx tracks a
 * same-domain streak as real state, and once it caps, the server is told
 * explicitly which domain to move away from instead of relying on the
 * model to have counted correctly on its own.
 */

export const TOPIC_DOMAINS = [
  "home_city",
  "family",
  "work_studies",
  "hobbies_free_time",
  "food_daily_life",
  "travel",
  "technology",
  "opinions_other",
] as const;

export type TopicDomain = (typeof TOPIC_DOMAINS)[number];

/** Openers exclude "opinions_other" — too open-ended for an A1 warm-up question. */
export const OPENER_DOMAINS: TopicDomain[] = TOPIC_DOMAINS.filter((d) => d !== "opinions_other");

export const DOMAIN_LABEL: Record<TopicDomain, string> = {
  home_city: "their home, neighbourhood, or the city/town they live in",
  family: "their family",
  work_studies: "their job or studies",
  hobbies_free_time: "their hobbies or free time",
  food_daily_life: "food or their daily routine",
  travel: "travel or a trip they've taken",
  technology: "technology or how they use it",
  opinions_other: "a general opinion question, unrelated to anything already covered",
};

export function isTopicDomain(value: unknown): value is TopicDomain {
  return typeof value === "string" && (TOPIC_DOMAINS as readonly string[]).includes(value);
}
