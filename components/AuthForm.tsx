"use client";

import { useState } from "react";
import type { AuthError } from "@supabase/supabase-js";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

export const MIN_PASSWORD_LENGTH = 8;

// Off until the Google provider is configured in Supabase — the button still
// renders (disabled) so the layout doesn't shift the day it's switched on.
const GOOGLE_ENABLED = process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === "true";

/** Client-side checks shared by sign-up and /login/reset. Null = valid. */
export function validateNewPassword(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`;
  }
  if (password !== confirm) return "Les deux mots de passe ne correspondent pas.";
  return null;
}

/** Supabase's English auth errors, in French for the candidate UI. */
export function authErrorMessage(error: AuthError): string {
  switch (error.code) {
    case "invalid_credentials":
      // Accounts created before the switch from magic links have no password yet.
      return "E-mail ou mot de passe incorrect. Première connexion depuis le changement ? Utilisez « Mot de passe oublié ».";
    case "user_already_exists":
    case "email_exists":
      return "Un compte existe déjà avec cet e-mail — connectez-vous.";
    case "weak_password":
      return `Mot de passe trop faible (au moins ${MIN_PASSWORD_LENGTH} caractères).`;
    case "same_password":
      return "Le nouveau mot de passe doit être différent de l'ancien.";
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
      return "Trop de tentatives, réessayez dans quelques minutes.";
    default:
      return error.message;
  }
}

export function authInputStyle(light: boolean): React.CSSProperties {
  return {
    padding: light ? "12px 14px" : "10px 12px",
    borderRadius: light ? 10 : 6,
    border: `1px solid ${light ? "#DDD9D0" : "#334155"}`,
    background: light ? "#FFFFFF" : "#0f172a",
    color: light ? "#141D33" : "#e5e7eb",
    // 16px: iOS Safari zooms the page in on focus for any input under 16px.
    fontSize: 16,
    fontFamily: light ? "'DM Sans',system-ui,sans-serif" : undefined,
  };
}

export function authButtonStyle(light: boolean, busy: boolean): React.CSSProperties {
  return {
    padding: light ? "13px 12px" : "10px 12px",
    borderRadius: light ? 10 : 6,
    border: "none",
    background: light ? "#141D33" : "#4f46e5",
    color: "#fff",
    fontFamily: light ? "'Outfit',sans-serif" : undefined,
    fontWeight: light ? 500 : 600,
    fontSize: 15,
    cursor: busy ? "default" : "pointer",
    opacity: busy ? 0.7 : 1,
  };
}

/**
 * Email + password sign-in / sign-up, used by /login (LoginForm), the welcome
 * screen (WelcomeAuthForm) and the post-session claim card (ClaimResultsForm).
 * "Confirm email" is off in the Supabase project, so signUp returns a session
 * immediately and both modes finish the same way: a hard navigation to `next`
 * so middleware and server components see the cookie the browser client just
 * wrote. `next` can be a function for callers that build it from the current
 * URL at submit time (WelcomeAuthForm keeps `?level=` that way).
 */
export function AuthForm({
  next,
  defaultMode,
  light = false,
}: {
  next: string | (() => string);
  defaultMode: "signin" | "signup";
  light?: boolean;
}) {
  const [mode, setMode] = useState(defaultMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "confirm-email" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const resolveNext = () => (typeof next === "function" ? next() : next);
  const busy = status === "sending";
  const muted = light ? "#5A5F6E" : "#94a3b8";

  const fail = (message: string) => {
    setStatus("error");
    setErrorMessage(message);
  };

  const switchMode = (m: "signin" | "signup") => {
    setMode(m);
    setStatus("idle");
    setErrorMessage(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    const supabase = getSupabaseBrowser();

    if (mode === "signin") {
      setStatus("sending");
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return fail(authErrorMessage(error));
      window.location.href = resolveNext();
      return;
    }

    const invalid = validateNewPassword(password, confirm);
    if (invalid) return fail(invalid);
    setStatus("sending");
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return fail(authErrorMessage(error));
    // Only happens if "Confirm email" gets switched back on in Supabase.
    if (!data.session) {
      setStatus("confirm-email");
      return;
    }
    window.location.href = resolveNext();
  };

  const signInWithGoogle = async () => {
    setErrorMessage(null);
    const { error } = await getSupabaseBrowser().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(resolveNext())}` },
    });
    if (error) fail(authErrorMessage(error));
  };

  if (status === "confirm-email") {
    return (
      <div style={{ color: muted, fontSize: 14, textAlign: "center", lineHeight: 1.5 }}>
        Vérifiez vos emails (<strong>{email}</strong>) pour confirmer votre compte.
      </div>
    );
  }

  const tab = (m: "signin" | "signup", label: string) => (
    <button
      type="button"
      onClick={() => switchMode(m)}
      style={{
        flex: 1,
        padding: "8px 0",
        border: "none",
        borderBottom: `2px solid ${mode === m ? (light ? "#141D33" : "#e5e7eb") : "transparent"}`,
        background: "none",
        color: mode === m ? (light ? "#141D33" : "#e5e7eb") : muted,
        fontFamily: light ? "'Outfit',sans-serif" : undefined,
        fontWeight: 500,
        fontSize: 15,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );

  const forgotHref = `/login/forgot?next=${encodeURIComponent(typeof next === "string" ? next : "/dashboard")}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", borderBottom: `1px solid ${light ? "#E4E0D7" : "#334155"}` }}>
        {tab("signin", "Se connecter")}
        {tab("signup", "Créer un compte")}
      </div>

      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <input
          type="email"
          required
          autoComplete="email"
          placeholder="toi@exemple.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={authInputStyle(light)}
        />
        <input
          type="password"
          required
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
          placeholder="Mot de passe"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={authInputStyle(light)}
        />
        {mode === "signup" && (
          <input
            type="password"
            required
            autoComplete="new-password"
            placeholder="Confirmer le mot de passe"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            style={authInputStyle(light)}
          />
        )}
        {status === "error" && errorMessage && (
          <div style={{ color: light ? "#B3542E" : "#f87171", fontSize: 13, lineHeight: 1.4 }}>{errorMessage}</div>
        )}
        <button type="submit" disabled={busy} style={authButtonStyle(light, busy)}>
          {busy ? "Un instant…" : mode === "signin" ? "Se connecter" : "Créer mon compte"}
        </button>
        {mode === "signin" && (
          <a href={forgotHref} style={{ color: muted, fontSize: 13, textAlign: "center" }}>
            Mot de passe oublié ?
          </a>
        )}
      </form>

      <div style={{ display: "flex", alignItems: "center", gap: 10, color: muted, fontSize: 12 }}>
        <div style={{ flex: 1, height: 1, background: light ? "#E4E0D7" : "#334155" }} />
        ou
        <div style={{ flex: 1, height: 1, background: light ? "#E4E0D7" : "#334155" }} />
      </div>

      <button
        type="button"
        onClick={signInWithGoogle}
        disabled={!GOOGLE_ENABLED}
        title={GOOGLE_ENABLED ? undefined : "Bientôt disponible"}
        style={{
          padding: light ? "12px 12px" : "10px 12px",
          borderRadius: light ? 10 : 6,
          border: `1px solid ${light ? "#DDD9D0" : "#334155"}`,
          background: light ? "#FFFFFF" : "none",
          color: light ? "#141D33" : "#e5e7eb",
          fontFamily: light ? "'Outfit',sans-serif" : undefined,
          fontWeight: 500,
          fontSize: 15,
          cursor: GOOGLE_ENABLED ? "pointer" : "default",
          opacity: GOOGLE_ENABLED ? 1 : 0.55,
        }}
      >
        Continuer avec Google{GOOGLE_ENABLED ? "" : " — bientôt disponible"}
      </button>
    </div>
  );
}
