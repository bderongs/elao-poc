import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Anon-key client for Server Components/Actions/route handlers that need
 * "who is logged in" — reads the session from cookies. Never used for
 * privileged data access; that stays on lib/supabase-server.ts's
 * service-role client (RLS denies the anon/authenticated roles entirely).
 */
export async function getSupabaseAuthServer() {
  const cookieStore = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component render, where cookies are
          // read-only — middleware's session refresh already keeps the
          // cookie fresh, so there's nothing to do here.
        }
      },
    },
  });
}
