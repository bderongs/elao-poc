/**
 * TT — Topic Tracking endpoint. Thin wrapper around lib/topic-tracking.ts —
 * called by app/page.tsx as soon as an examiner reply's full text is known
 * (non-blocking, same pattern as app/api/assess-transcript/route.ts for ET).
 */

import { classifyTopicDomain } from "@/lib/topic-tracking";
import { assessProcessLabel } from "@/lib/turn-labels";
import { logServerEvent } from "@/lib/server-log";

export const runtime = "nodejs";

interface ClassifyRequest {
  questionAsked: string;
  /** Tail of the conversation right before this question — see lib/topic-tracking.ts. */
  recentExchange?: string;
  turnLogId: string;
}

export async function POST(req: Request) {
  const { questionAsked, recentExchange, turnLogId } = (await req.json()) as ClassifyRequest;
  const process = assessProcessLabel("TT", turnLogId);

  if (!questionAsked?.trim()) {
    return Response.json({ domain: null });
  }

  logServerEvent("tt_request_received", { turnLogId, process });
  const domain = await classifyTopicDomain({ questionAsked, recentExchange, turnLogId, process });
  logServerEvent("tt_complete", { turnLogId, process, domain });
  return Response.json({ domain });
}
