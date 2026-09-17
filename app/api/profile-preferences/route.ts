import { getCurrentUser } from "@/lib/current-user";
import { getSupabaseServer } from "@/lib/supabase-server";

export const runtime = "nodejs";

/**
 * GET /api/profile-preferences — PUBLIC (not in middleware.ts's matcher,
 * deliberately: the welcome screen at app/page.tsx calls this for every
 * visitor, most of whom are guests). Returns the signed-in caller's
 * remembered language/rung, or `null` when signed out or when they have none
 * yet — both are normal, expected cases, not errors.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json(null);

  const { data, error } = await getSupabaseServer()
    .from("profiles")
    .select("last_language, last_rung")
    .eq("id", user.id)
    .single();
  if (error || !data?.last_language || !data?.last_rung) return Response.json(null);

  return Response.json({ language: data.last_language, rung: data.last_rung });
}
