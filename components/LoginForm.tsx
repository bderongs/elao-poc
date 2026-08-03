"use client";

import { useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

/**
 * Magic-link sign-in for returning users — same mechanism as
 * ClaimResultsForm/AdminLoginForm, but redirects through `next` (defaults to
 * /dashboard) instead of a fresh account's claim flow.
 */
export function LoginForm({ next }: { next: string }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("sending");
    setErrorMessage(null);
    const { error } = await getSupabaseBrowser().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    if (error) {
      setStatus("error");
      setErrorMessage(error.message);
      return;
    }
    setStatus("sent");
  };

  if (status === "sent") {
    return (
      <div style={{ color: "#e5e7eb", fontSize: 13, textAlign: "center" }}>
        Vérifie tes emails (<strong>{email}</strong>) pour te connecter.
      </div>
    );
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <input
        type="email"
        required
        autoFocus
        placeholder="toi@exemple.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        style={{
          padding: "8px 10px",
          borderRadius: 4,
          border: "1px solid #334155",
          background: "#0f172a",
          color: "#e5e7eb",
          fontSize: 14,
        }}
      />
      {status === "error" && errorMessage && (
        <div style={{ color: "#f87171", fontSize: 12 }}>{errorMessage}</div>
      )}
      <button
        type="submit"
        disabled={status === "sending"}
        style={{
          padding: "8px 10px",
          borderRadius: 4,
          border: "none",
          background: "#4f46e5",
          color: "#fff",
          fontWeight: 600,
          fontSize: 14,
          cursor: status === "sending" ? "default" : "pointer",
          opacity: status === "sending" ? 0.7 : 1,
        }}
      >
        {status === "sending" ? "Envoi…" : "Recevoir mon lien de connexion"}
      </button>
    </form>
  );
}
