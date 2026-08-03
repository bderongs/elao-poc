"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

/**
 * Small corner link on the homepage so a returning logged-in user can find
 * their way to /dashboard, and a signed-out one can find /login — the
 * homepage (app/page.tsx) otherwise has zero auth awareness. Renders nothing
 * until the client-side auth check resolves, to avoid a wrong flash.
 */
export function AuthNavLink() {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    getSupabaseBrowser()
      .auth.getUser()
      .then(({ data }) => {
        if (!cancelled) setLoggedIn(!!data.user);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loggedIn === null) return null;

  return (
    <a
      href={loggedIn ? "/dashboard" : "/login"}
      style={{ fontSize: 13, color: "#94a3b8", textDecoration: "none" }}
    >
      {loggedIn ? "Mes sessions" : "Se connecter"}
    </a>
  );
}
