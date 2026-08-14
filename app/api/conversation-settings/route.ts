import { resolveConversationSettings } from "@/lib/conversation-settings-service";
import { isConvLang } from "@/lib/conversation-prompts";

export const runtime = "nodejs";

/**
 * GET /api/conversation-settings?language=xx — PUBLIC (not in middleware.ts's
 * matcher, deliberately: the live conversation page calls this at session
 * start and practice-takers are never authenticated, unlike the admin-gated
 * PATCH/DELETE at /api/conversation-settings/[language]).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const language = url.searchParams.get("language");

  if (!isConvLang(language)) {
    return Response.json({ error: "Invalid or missing language" }, { status: 400 });
  }

  try {
    const settings = await resolveConversationSettings(language);
    return Response.json(settings);
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
