import { cache } from "react";
import { getSupabaseAuthServer } from "@/lib/supabase-auth-server";

/**
 * "Who is logged in" for the current request, deduped via React's cache() —
 * auth.getUser() is a network validation call, not a local decode, so
 * layout + page both needing it in the same render shouldn't pay for it twice.
 */
export const getCurrentUser = cache(async () => {
  const supabase = await getSupabaseAuthServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});
