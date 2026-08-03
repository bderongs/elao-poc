import { NextResponse } from "next/server";
import { getSupabaseAuthServer } from "@/lib/supabase-auth-server";

/**
 * Where every magic link points back to (admin and — later — end-user
 * sign-in both share this). Exchanges Supabase's `code` for a session
 * cookie, then continues on to wherever the sign-in started from.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await getSupabaseAuthServer();
    await supabase.auth.exchangeCodeForSession(code);
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
