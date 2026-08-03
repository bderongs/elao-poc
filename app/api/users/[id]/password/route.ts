import { NextResponse } from "next/server";
import { setUserPassword } from "@/lib/users-service";

export const runtime = "nodejs";

/**
 * PATCH /api/users/:id/password — admin-only (gated by middleware.ts).
 * Sets a password via the service-role admin API, no email involved — the
 * only account-provisioning path that works while Supabase's auth-email
 * rate limit is blocking magic links.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { password } = await req.json();
  if (typeof password !== "string" || password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }

  try {
    await setUserPassword(id, password);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
