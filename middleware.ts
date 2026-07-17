import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE_NAME, isValidAdminCookie } from "@/lib/admin-auth";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname === "/admin/login") return NextResponse.next();

  const cookie = req.cookies.get(ADMIN_COOKIE_NAME)?.value;
  if (await isValidAdminCookie(cookie)) return NextResponse.next();

  const loginUrl = new URL("/admin/login", req.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/admin/:path*"],
};
