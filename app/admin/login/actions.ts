"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_COOKIE_NAME, adminSessionToken, verifyAdminPassword } from "@/lib/admin-auth";

export async function login(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/admin");

  if (!verifyAdminPassword(password)) {
    redirect(`/admin/login?error=1&next=${encodeURIComponent(next)}`);
  }

  const token = await adminSessionToken();
  if (!token) {
    // ADMIN_PASSWORD not configured server-side.
    redirect(`/admin/login?error=config&next=${encodeURIComponent(next)}`);
  }

  (await cookies()).set(ADMIN_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });

  redirect(next);
}

export async function logout() {
  (await cookies()).delete(ADMIN_COOKIE_NAME);
  redirect("/admin/login");
}
