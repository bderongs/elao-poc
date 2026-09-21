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

/**
 * Where the next question goes once the same-domain streak caps. Telling the
 * model only "not X" proved too easy to satisfy with a near-variant of X (e.g.
 * "another French city" after a run of questions on the home city — same
 * domain, so the streak never reset). Instead the client picks a concrete
 * TARGET domain it hasn't visited yet and the prompt gets a seed idea for it.
 * Seeds are ideas to be rephrased in the session language, not verbatim text.
 *   everyday: simple, concrete — A1–B2 rungs.
 *   abstract: standalone opinion questions every adult has views on, needing
 *             no local/specialist knowledge — C1/C2 (the language is what's
 *             being tested, not what the speaker happens to know).
 */
export const SWITCH_SEEDS: Record<TopicDomain, { everyday: string[]; abstract: string[] }> = {
  home_city: {
    everyday: ["Tell me about the place where you live.", "What do you like about your neighbourhood?"],
    abstract: ["What makes a place feel like home rather than just somewhere you live?", "Is it better to live somewhere you love with fewer opportunities, or somewhere less pleasant with more?"],
  },
  family: {
    everyday: ["Tell me about your family.", "Who in your family are you closest to?"],
    abstract: ["How much does the family you grow up in shape the adult you become?", "What do adults owe their parents as they age?"],
  },
  work_studies: {
    everyday: ["What do you do for work or studies?", "What does a normal day at work or school look like for you?"],
    abstract: ["What makes work meaningful beyond the salary?", "Is a university degree still the best preparation for a career?"],
  },
  hobbies_free_time: {
    everyday: ["What do you like to do in your free time?", "Is there a hobby you would like to start?"],
    abstract: ["Why do people need pastimes that serve no productive purpose?", "Is it better to be excellent at one thing or decent at many?"],
  },
  food_daily_life: {
    everyday: ["What do you usually eat for dinner?", "Describe your morning routine."],
    abstract: ["How much do eating habits say about a culture?", "Should food traditions change with the times?"],
  },
  travel: {
    everyday: ["Tell me about a trip you enjoyed.", "Where would you like to travel next?"],
    abstract: ["Does travelling really change the way people think?", "Is mass tourism destroying the places people love?"],
  },
  technology: {
    everyday: ["How do you use your phone every day?", "Which app or device could you not live without?"],
    abstract: ["Has technology made people more connected or more isolated?", "Who should be responsible for what children see online?"],
  },
  opinions_other: {
    everyday: ["What are you looking forward to this month?", "What is something that made you laugh recently?"],
    abstract: ["Is it ever right to break a rule you believe is unjust?", "Is a useful lie ever acceptable in a society?"],
  },
};

/** Picks the next domain to steer to: one not yet visited this session (and never the current one), else any other. */
export function pickSwitchDomain(current: TopicDomain | null, visited: TopicDomain[]): TopicDomain {
  const others = TOPIC_DOMAINS.filter((d) => d !== current);
  const fresh = others.filter((d) => !visited.includes(d));
  const pool = fresh.length ? fresh : others;
  return pool[Math.floor(Math.random() * pool.length)];
}
