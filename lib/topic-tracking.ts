/**
 * TT — Topic Tracking: a small, fast, text-only classifier that tags which
 * broad life domain the examiner's OWN last question belongs to. Exists for
 * the same reason ET (lib/level-assessment.ts) does: asking the main
 * answering call (app/api/chat/route.ts) to self-count "how many turns in a
 * row have I spent on this subject" purely in prose proved unreliable in
 * practice (see conversation-prompts.ts's REALISM rule history) — the model
 * would either lose count over the conversation or treat a same-subject
 * rephrasing (e.g. "what's the strongest argument against X") as if it were
 * a fresh topic. Splitting the judgment out into its own call, the same way
 * pacing was split out into ET, makes topic-breadth real, server-tracked
 * state instead of something the model has to remember unaided.
 *
 * Called from app/api/classify-topic/route.ts, fired by the client
 * (app/page.tsx's runTopicClassification) as soon as an examiner reply's
 * full text is known — best-effort/non-blocking, same tolerance as ET: the
 * next /api/chat call uses whatever the latest completed result says, stale
 * or not.
 */

import { mistralComplete, mistralChatModel } from "@/lib/mistral";
import { logServerEvent } from "@/lib/server-log";
import { TOPIC_DOMAINS, isTopicDomain, type TopicDomain } from "@/lib/topic-domain";

const SYSTEM_PROMPT = `You are a fast topic classifier for a spoken-language oral exam. Given the question the examiner just asked, decide which single domain it belongs to.

Domains: ${TOPIC_DOMAINS.join(", ")}

- home_city: their home, neighbourhood, or the city/town they live in.
- family: their family.
- work_studies: their job or studies.
- hobbies_free_time: hobbies or free time.
- food_daily_life: food or daily routine.
- travel: travel or a trip.
- technology: technology or how they use it.
- opinions_other: a general opinion question, or anything that doesn't fit the above.

If the question is a rephrasing, deeper follow-up, or a counter-argument/downside about the same underlying subject as a previous question (e.g. "what do you like about X" vs "what's the strongest argument against X"), classify it under the SAME domain as that subject — polarity or angle does not change the domain. The question may refer back to the recent exchange with words like "that", "it", or "the X you just described" — use the recent exchange (given below, if any) to resolve what it actually refers to before picking a domain; do not classify purely on the surface wording of a question that has no content of its own without that context.

Return ONLY JSON, no markdown fences: {"domain": "..."}`;

export async function classifyTopicDomain(params: {
  questionAsked: string;
  /** Tail of the conversation immediately before this question — resolves references like "that" or "the lifestyle you just described" that the bare question text can't be classified from on its own. */
  recentExchange?: string;
  turnLogId: string;
  process: string;
}): Promise<TopicDomain | null> {
  try {
    const userContent = params.recentExchange
      ? `Recent exchange:\n${params.recentExchange}\n\nQuestion to classify: "${params.questionAsked}"`
      : `Question to classify: "${params.questionAsked}"`;
    const raw = await mistralComplete({
      model: mistralChatModel(),
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
      maxTokens: 20,
      json: true,
      context: params.process,
    });
    const cleaned = raw.trim().replace(/^```json\s*|\s*```$/g, "").trim();
    const parsed = JSON.parse(cleaned) as { domain?: string };
    return isTopicDomain(parsed.domain) ? parsed.domain : null;
  } catch (e) {
    logServerEvent("tt_failed", { turnLogId: params.turnLogId, process: params.process, error: String(e) });
    return null;
  }
}
