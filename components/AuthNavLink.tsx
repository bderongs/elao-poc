"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { useUi } from "@/lib/ui-lang";

/**
 * Small corner link on the homepage so a returning logged-in user can find
 * their way to /dashboard, and a signed-out one can find /login — the
 * homepage (app/page.tsx) otherwise has zero auth awareness. Renders nothing
 * until the client-side auth check resolves, to avoid a wrong flash.
 */
export function AuthNavLink({ light = false }: { light?: boolean }) {
  const { t } = useUi();
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
      // A real button (navy, like the main call to action) so it reads apart from the language menu next to it.
      style={
        light
          ? {
              padding: "8px 16px",
              borderRadius: 8,
              background: "#141D33",
              color: "#FFFFFF",
              fontFamily: "'Outfit',sans-serif",
              fontSize: 14,
              fontWeight: 500,
              textDecoration: "none",
              whiteSpace: "nowrap",
            }
          : { fontSize: 14, color: "#94a3b8", textDecoration: "none" }
      }
    >
      {loggedIn ? t.nav.mySessions : t.nav.signIn}
    </a>
  );
}
