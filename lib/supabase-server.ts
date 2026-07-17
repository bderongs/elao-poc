import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Service-role client — server-only. Never import this from a "use client"
// file or expose SUPABASE_SERVICE_ROLE_KEY to the browser bundle.
let _client: SupabaseClient | null = null;

export function getSupabaseServer(): SupabaseClient {
  if (!_client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("Supabase server env vars not set");
    _client = createClient(url, key, { auth: { persistSession: false } });
  }
  return _client;
}
