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
      <div style={{ color: "#5A5F6E", fontSize: 14, textAlign: "center", lineHeight: 1.5 }}>
        Vérifie tes emails (<strong>{email}</strong>) pour te connecter.
      </div>
    );
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <input
        type="email"
        required
        autoFocus
        placeholder="toi@exemple.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        style={{
          padding: "12px 14px",
          borderRadius: 10,
          border: "1px solid #DDD9D0",
          background: "#FFFFFF",
          color: "#141D33",
          // 16px: iOS Safari zooms the page in on focus for any input under 16px.
          fontSize: 16,
          fontFamily: "'DM Sans',system-ui,sans-serif",
        }}
      />
      {status === "error" && errorMessage && (
        <div style={{ color: "#B3542E", fontSize: 13 }}>{errorMessage}</div>
      )}
      <button
        type="submit"
        disabled={status === "sending"}
        style={{
          padding: "13px 12px",
          borderRadius: 10,
          border: "none",
          background: "#141D33",
          color: "#fff",
          fontFamily: "'Outfit',sans-serif",
          fontWeight: 500,
          fontSize: 15,
          cursor: status === "sending" ? "default" : "pointer",
          opacity: status === "sending" ? 0.7 : 1,
        }}
      >
        {status === "sending" ? "Envoi…" : "Recevoir mon lien de connexion"}
      </button>
    </form>
  );
}
