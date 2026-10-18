import { NextResponse } from "next/server";
import { getSupabaseAuthServer } from "@/lib/supabase-auth-server";
import { safeNext } from "@/lib/safe-next";

/**
 * Where Supabase redirects back after an emailed link (password reset, see
 * app/login/forgot) or an OAuth provider (Google, once enabled — see
 * components/AuthForm.tsx). Exchanges Supabase's `code` for a session
 * cookie, then continues on to wherever the flow started from. A missing or
 * expired code goes to /login with an error instead of silently landing on
 * `next` logged out.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next"), "/");

  const supabase = await getSupabaseAuthServer();
  const { error } = code ? await supabase.auth.exchangeCodeForSession(code) : { error: true };
  if (error) return NextResponse.redirect(new URL("/login?error=link", url.origin));

  return NextResponse.redirect(new URL(next, url.origin));
}
