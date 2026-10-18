"use client";

import { AuthForm } from "@/components/AuthForm";

/**
 * /login: email + password for returning users (with a tab to create an
 * account), redirecting to `next` — defaults to /dashboard.
 */
export function LoginForm({ next }: { next: string }) {
  return <AuthForm next={next} defaultMode="signin" light />;
}
