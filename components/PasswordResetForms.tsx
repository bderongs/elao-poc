"use client";

import { useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { authButtonStyle, authErrorMessage, authInputStyle, validateNewPassword } from "@/components/AuthForm";

/**
 * Step 1 (/login/forgot): emails a Supabase reset link that comes back
 * through /auth/callback (which logs the user in) to /login/reset. Always
 * shows the same confirmation so the page doesn't reveal which addresses
 * have an account.
 */
export function ForgotPasswordForm({ next }: { next: string }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("sending");
    setErrorMessage(null);
    const resetPath = `/login/reset?next=${encodeURIComponent(next)}`;
    const { error } = await getSupabaseBrowser().auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(resetPath)}`,
    });
    // Rate limits are worth surfacing; anything else would leak whether the
    // account exists, so it gets the same "sent" screen.
    if (error && error.code?.startsWith("over_")) {
      setStatus("error");
      setErrorMessage(authErrorMessage(error));
      return;
    }
    setStatus("sent");
  };

  if (status === "sent") {
    return (
      <div style={{ color: "#5A5F6E", fontSize: 14, textAlign: "center", lineHeight: 1.5 }}>
        Si un compte existe pour <strong>{email}</strong>, un e-mail vous a été envoyé avec un lien pour choisir un
        nouveau mot de passe.
      </div>
    );
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <input
        type="email"
        required
        autoFocus
        autoComplete="email"
        placeholder="toi@exemple.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        style={authInputStyle(true)}
      />
      {status === "error" && errorMessage && <div style={{ color: "#B3542E", fontSize: 13 }}>{errorMessage}</div>}
      <button type="submit" disabled={status === "sending"} style={authButtonStyle(true, status === "sending")}>
        {status === "sending" ? "Envoi…" : "Recevoir le lien"}
      </button>
    </form>
  );
}

/** Step 2 (/login/reset): the reset link already logged the user in — set the new password. */
export function ResetPasswordForm({ next }: { next: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fail = (message: string) => {
    setStatus("error");
    setErrorMessage(message);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    const invalid = validateNewPassword(password, confirm);
    if (invalid) return fail(invalid);
    setStatus("sending");
    const { error } = await getSupabaseBrowser().auth.updateUser({ password });
    if (error) return fail(authErrorMessage(error));
    window.location.href = next;
  };

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <input
        type="password"
        required
        autoFocus
        autoComplete="new-password"
        placeholder="Nouveau mot de passe"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        style={authInputStyle(true)}
      />
      <input
        type="password"
        required
        autoComplete="new-password"
        placeholder="Confirmer le mot de passe"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        style={authInputStyle(true)}
      />
      {status === "error" && errorMessage && <div style={{ color: "#B3542E", fontSize: 13 }}>{errorMessage}</div>}
      <button type="submit" disabled={status === "sending"} style={authButtonStyle(true, status === "sending")}>
        {status === "sending" ? "Enregistrement…" : "Enregistrer le mot de passe"}
      </button>
    </form>
  );
}
