import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE_NAME, isValidAdminCookie } from "@/lib/admin-auth";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname === "/admin/login") return NextResponse.next();

  // Public: the live conversation UI posts here to save a completed session.
  // Every other /api/sessions* route (list, detail, replay-evaluate) is
  // admin-only.
  if (pathname === "/api/sessions" && req.method === "POST") return NextResponse.next();

  const cookie = req.cookies.get(ADMIN_COOKIE_NAME)?.value;
  if (await isValidAdminCookie(cookie)) return NextResponse.next();

  // API routes are fetched by JS, not navigated to — 401 instead of redirecting.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/admin/login", req.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/admin/:path*", "/api/sessions", "/api/sessions/:id", "/api/sessions/:id/evaluate"],
};
