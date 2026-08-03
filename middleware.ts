import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseMiddlewareClient } from "@/lib/supabase-middleware";
import { getSupabaseServer } from "@/lib/supabase-server";

async function isAdmin(userId: string): Promise<boolean> {
  const { data } = await getSupabaseServer().from("profiles").select("role").eq("id", userId).single();
  return data?.role === "admin";
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const { supabase, response } = getSupabaseMiddlewareClient(req);

  // Refreshes the session cookie if needed — must run before any other
  // check, and `response` (not a bare NextResponse.next()) must carry
  // through on every path below or a refreshed cookie gets dropped.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (pathname === "/admin/login") return response;

  // Public: the live conversation UI posts here to save a completed session.
  // Every other /api/sessions* route (list, detail, replay-evaluate) is
  // admin-only.
  if (pathname === "/api/sessions" && req.method === "POST") return response;

  if (user && (await isAdmin(user.id))) return response;

  // API routes are fetched by JS, not navigated to — 401 instead of redirecting.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/admin/login", req.url);
  loginUrl.searchParams.set("next", pathname);
  if (user) loginUrl.searchParams.set("error", "forbidden");
  const redirect = NextResponse.redirect(loginUrl);
  response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
  return redirect;
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/api/sessions",
    "/api/sessions/upload",
    "/api/sessions/speechace-import",
    "/api/sessions/:id",
    "/api/sessions/:id/evaluate",
    "/api/sessions/:id/recompute",
    "/api/sessions/:id/turns",
    "/api/sessions/:id/turns/:turnId/assess",
    "/api/sessions/:id/assess-all",
  ],
};
