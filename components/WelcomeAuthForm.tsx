"use client";

import { AuthForm } from "@/components/AuthForm";

/**
 * Inline sign-in/sign-up on the welcome flow's "auth" step (app/page.tsx).
 * Redirects to "/" plus the CURRENT page's query string (not a fixed path like
 * LoginForm's `/dashboard` default) so a `?level=B1` invite-link param
 * survives signing in — see doc/adaptive-levels-plan.md's precedence note.
 */
export function WelcomeAuthForm({
  light = false,
  defaultMode = "signin",
}: {
  light?: boolean;
  defaultMode?: "signin" | "signup";
}) {
  return <AuthForm next={() => `/${window.location.search}`} defaultMode={defaultMode} light={light} />;
}
