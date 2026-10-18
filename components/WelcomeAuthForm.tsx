"use client";

import { AuthForm } from "@/components/AuthForm";

/**
 * Inline sign-in/sign-up on the welcome screen (app/page.tsx). Redirects to
 * "/" plus the CURRENT page's query string (not a fixed path like
 * LoginForm's `/dashboard` default) so a `?level=B1` invite-link param
 * survives signing in — see doc/adaptive-levels-plan.md's precedence note.
 */
export function WelcomeAuthForm({ light = false }: { light?: boolean }) {
  return <AuthForm next={() => `/${window.location.search}`} defaultMode="signin" light={light} />;
}
