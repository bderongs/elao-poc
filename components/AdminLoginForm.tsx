"use client";

import { useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { adminColors } from "@/lib/admin-theme";

const inputStyle: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 4,
  border: `1px solid ${adminColors.border}`,
  background: adminColors.bg,
  color: adminColors.ink,
  fontSize: 14,
};

/**
 * Email + password only — admins are regular accounts whose profile has
 * role 'admin'. A forgotten password goes through the candidate-facing
 * /login/forgot reset flow (or another admin sets one via /admin/users).
 */
export function AdminLoginForm({ next, error }: { next: string; error?: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("sending");
    setErrorMessage(null);
    const { error } = await getSupabaseBrowser().auth.signInWithPassword({ email, password });
    if (error) {
      setStatus("error");
      setErrorMessage(error.message);
      return;
    }
    // Hard navigation so middleware re-runs with the session cookie the
    // browser client just wrote, instead of a client-side route that would
    // still see the pre-login request.
    window.location.href = next;
  };

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <input
        type="email"
        required
        autoFocus
        autoComplete="email"
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        style={inputStyle}
      />

      {error === "forbidden" && (
        <div style={{ color: adminColors.danger, fontSize: 12 }}>That account doesn&apos;t have admin access.</div>
      )}

      <input
        type="password"
        required
        autoComplete="current-password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        style={inputStyle}
      />
      {status === "error" && errorMessage && (
        <div style={{ color: adminColors.danger, fontSize: 12 }}>{errorMessage}</div>
      )}
      <button
        type="submit"
        disabled={status === "sending"}
        style={{
          padding: "8px 10px",
          borderRadius: 4,
          border: "none",
          background: adminColors.ink,
          color: "#fff",
          fontWeight: 600,
          fontSize: 14,
          cursor: status === "sending" ? "default" : "pointer",
          opacity: status === "sending" ? 0.7 : 1,
        }}
      >
        {status === "sending" ? "Signing in…" : "Sign in"}
      </button>
      <a
        href={`/login/forgot?next=${encodeURIComponent(next)}`}
        style={{ color: adminColors.muted, fontSize: 12, textAlign: "center" }}
      >
        Forgot password?
      </a>
    </form>
  );
}
