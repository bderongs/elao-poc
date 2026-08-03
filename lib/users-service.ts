import { getSupabaseServer } from "@/lib/supabase-server";
import type { UserRow } from "@/lib/types";

// Single source of truth for the admin "Users" page — joins profiles (role)
// with auth.users (email, via the admin API — profiles has no email column)
// and a per-account count of claimed sessions.

export async function listUsers(): Promise<UserRow[]> {
  const supabase = getSupabaseServer();

  const [profilesResult, authResult, sessionsResult] = await Promise.all([
    supabase.from("profiles").select("id, role, display_name, created_at"),
    // perPage caps at 1000 users — fine at this app's current scale; would
    // need real pagination (or a paginated admin API loop) past that.
    supabase.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    supabase.from("sessions").select("user_id").not("user_id", "is", null),
  ]);

  if (profilesResult.error) throw new Error(profilesResult.error.message);
  if (authResult.error) throw new Error(authResult.error.message);
  if (sessionsResult.error) throw new Error(sessionsResult.error.message);

  const emailById = new Map(authResult.data.users.map((u) => [u.id, u.email ?? null]));

  const sessionCountById = new Map<string, number>();
  for (const row of sessionsResult.data ?? []) {
    const userId = row.user_id as string | null;
    if (!userId) continue;
    sessionCountById.set(userId, (sessionCountById.get(userId) ?? 0) + 1);
  }

  return (profilesResult.data ?? [])
    .map((p): UserRow => ({
      id: p.id,
      email: emailById.get(p.id) ?? null,
      role: p.role as "user" | "admin",
      displayName: p.display_name,
      createdAt: p.created_at,
      sessionCount: sessionCountById.get(p.id) ?? 0,
    }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function setUserRole(id: string, role: "user" | "admin"): Promise<void> {
  const supabase = getSupabaseServer();
  const { error } = await supabase.from("profiles").update({ role }).eq("id", id);
  if (error) throw new Error(error.message);
}

// Sets a password via the admin API — doesn't touch email delivery at all,
// so it works even while Supabase's auth-email rate limit is blocking
// magic links. Lets an admin hand a colleague working credentials directly
// instead of waiting on (or generating) a link.
export async function setUserPassword(id: string, password: string): Promise<void> {
  const supabase = getSupabaseServer();
  const { error } = await supabase.auth.admin.updateUserById(id, { password });
  if (error) throw new Error(error.message);
}
