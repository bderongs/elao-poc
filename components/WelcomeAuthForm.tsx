"use client";

import { useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

/**
 * Inline magic-link sign-in/sign-up on the welcome screen (app/page.tsx),
 * same mechanism as LoginForm/ClaimResultsForm. Redirects through `next`
 * built from the CURRENT page's query string (not a fixed path like
 * LoginForm's `/dashboard` default) so a `?level=B1` invite-link param
 * survives the round trip through the user's email client and back through
 * /auth/callback, landing back on "/" with the param intact — see
 * doc/adaptive-levels-plan.md's precedence note.
 */
export function WelcomeAuthForm({ light = false }: { light?: boolean }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("sending");
    setErrorMessage(null);
    const next = `/${window.location.search}`;
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
      <div style={{ color: light ? "#5A5F6E" : "#e5e7eb", fontSize: 13, textAlign: "center" }}>
        Vérifie tes emails (<strong>{email}</strong>) pour te connecter.
      </div>
    );
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <input
        type="email"
        required
        placeholder="toi@exemple.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        style={{
          padding: "10px 12px",
          borderRadius: 6,
          border: `1px solid ${light ? "#DDD9D0" : "#334155"}`,
          background: light ? "#FFFFFF" : "#0f172a",
          color: light ? "#141D33" : "#e5e7eb",
          fontSize: 14,
          fontFamily: light ? "'DM Sans',system-ui,sans-serif" : undefined,
        }}
      />
      {status === "error" && errorMessage && (
        <div style={{ color: "#f87171", fontSize: 12 }}>{errorMessage}</div>
      )}
      <button
        type="submit"
        disabled={status === "sending"}
        style={{
          padding: "10px 12px",
          borderRadius: light ? 10 : 6,
          border: "none",
          background: light ? "#141D33" : "#4f46e5",
          color: "#fff",
          fontWeight: 600,
          fontFamily: light ? "'Outfit',sans-serif" : undefined,
          fontSize: 14,
          cursor: status === "sending" ? "default" : "pointer",
          opacity: status === "sending" ? 0.7 : 1,
        }}
      >
        {status === "sending" ? "Envoi…" : "Se connecter / créer un compte"}
      </button>
    </form>
  );
}
