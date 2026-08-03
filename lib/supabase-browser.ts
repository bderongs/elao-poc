import { createBrowserClient } from "@supabase/ssr";

// Anon-key client for "use client" components — magic-link and password
// sign-in only. Never used for data reads/writes: those still go through
// server routes backed by lib/supabase-server.ts's service-role client.
export function getSupabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
