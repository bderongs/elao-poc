import { createBrowserClient } from "@supabase/ssr";

// Anon-key client for "use client" components — magic-link and password
// sign-in, plus uploading a live session's audio to Storage through signed
// upload URLs minted server-side (app/api/sessions/audio-urls). Never used
// for database reads/writes: those still go through server routes backed by
// lib/supabase-server.ts's service-role client.
export function getSupabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
