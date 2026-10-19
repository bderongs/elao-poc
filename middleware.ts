import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseMiddlewareClient } from "@/lib/supabase-middleware";
import { getSupabaseServer } from "@/lib/supabase-server";
import { rateLimit, RATE_LIMITED_PATHS } from "@/lib/rate-limit";

async function isAdmin(userId: string): Promise<boolean> {
  const { data } = await getSupabaseServer().from("profiles").select("role").eq("id", userId).single();
  return data?.role === "admin";
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Public routes that call paid AI providers: a per-IP rate limit and
  // nothing else (lib/rate-limit.ts) — checked before the Supabase client, so
  // these calls pay no auth round trip.
  if (RATE_LIMITED_PATHS.includes(pathname)) {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
    const retryAfter = rateLimit(pathname, ip);
    if (retryAfter === null) return NextResponse.next();
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(retryAfter) } });
  }

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
  // Signed upload URLs for that save's audio (browser uploads straight to Storage).
  if (pathname === "/api/sessions/audio-urls" && req.method === "POST") return response;
  // Live-session incremental save (start + per-answer progress) — same public carve-out.
  if (pathname === "/api/sessions/live" && (req.method === "POST" || req.method === "PATCH")) return response;

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
    "/api/sessions/live",
    "/api/sessions/audio-urls",
    "/api/sessions/upload",
    "/api/sessions/speechace-import",
    "/api/sessions/:id",
    "/api/sessions/:id/evaluate",
    "/api/sessions/:id/recompute",
    "/api/sessions/:id/promote-rollup",
    "/api/sessions/:id/turns",
    "/api/sessions/:id/turns/:turnId/assess",
    "/api/sessions/:id/turns/:turnId/stt-lab",
    "/api/sessions/:id/assess-all",
    "/api/users/:path*",
    "/api/simulations",
    // The bare GET /api/conversation-settings is deliberately NOT listed here
    // — it's public, called by the live conversation page at session start.
    // Only the per-language PATCH/DELETE sub-route is admin-gated.
    "/api/conversation-settings/:language",
    // Rate-limited only (lib/rate-limit.ts's RATE_LIMITED_PATHS) — the matcher
    // must be a static list, so these are repeated here.
    "/api/chat",
    "/api/transcribe",
    "/api/pronunciation",
    "/api/assess-transcript",
    "/api/classify-topic",
    "/api/realtime-token",
    "/api/gradium-token",
    "/api/evaluate",
  ],
};
