"use server";

import { redirect } from "next/navigation";
import { getSupabaseAuthServer } from "@/lib/supabase-auth-server";

export async function logout() {
  const supabase = await getSupabaseAuthServer();
  await supabase.auth.signOut();
  redirect("/");
}
