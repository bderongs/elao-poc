import { NextResponse } from "next/server";
import { setUserRole } from "@/lib/users-service";
import { getSupabaseAuthServer } from "@/lib/supabase-auth-server";

export const runtime = "nodejs";

/**
 * PATCH /api/users/:id/role — admin-only (gated by middleware.ts).
 * Blocks an admin from demoting their own account: there's no recovery UI
 * once the last admin drops to 'user', so this is the only guard against it.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { role } = await req.json();
  if (role !== "user" && role !== "admin") {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  const supabase = await getSupabaseAuthServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user?.id === id && role !== "admin") {
    return NextResponse.json({ error: "You can't remove your own admin access." }, { status: 400 });
  }

  try {
    await setUserRole(id, role);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
