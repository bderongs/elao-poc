"use client";

import { useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

const inputStyle: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 4,
  border: "1px solid #334155",
  background: "#0f172a",
  color: "#e5e7eb",
  fontSize: 14,
};

/**
 * Two independent sign-in paths: password (instant, no email — the only
 * option that works while Supabase's auth-email rate limit is blocking
 * magic links) and magic link (no password to manage, but email-dependent).
 * An account only has a password if an admin set one via /admin/users.
 */
export function AdminLoginForm({ next, error }: { next: string; error?: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordStatus, setPasswordStatus] = useState<"idle" | "sending" | "error">("idle");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [linkStatus, setLinkStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [linkError, setLinkError] = useState<string | null>(null);

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordStatus("sending");
    setPasswordError(null);
    const { error } = await getSupabaseBrowser().auth.signInWithPassword({ email, password });
    if (error) {
      setPasswordStatus("error");
      setPasswordError(error.message);
      return;
    }
    // Hard navigation so middleware re-runs with the session cookie the
    // browser client just wrote, instead of a client-side route that would
    // still see the pre-login request.
    window.location.href = next;
  };

  const submitMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setLinkStatus("sending");
    setLinkError(null);
    const { error } = await getSupabaseBrowser().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    if (error) {
      setLinkStatus("error");
      setLinkError(error.message);
      return;
    }
    setLinkStatus("sent");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <input
        type="email"
        required
        autoFocus
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        style={inputStyle}
      />

      {error === "forbidden" && (
        <div style={{ color: "#f87171", fontSize: 12 }}>That account doesn&apos;t have admin access.</div>
      )}

      <form onSubmit={submitPassword} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <input
          type="password"
          required
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={inputStyle}
        />
        {passwordStatus === "error" && passwordError && (
          <div style={{ color: "#f87171", fontSize: 12 }}>{passwordError}</div>
        )}
        <button
          type="submit"
          disabled={passwordStatus === "sending"}
          style={{
            padding: "8px 10px",
            borderRadius: 4,
            border: "none",
            background: "#4f46e5",
            color: "#fff",
            fontWeight: 600,
            fontSize: 14,
            cursor: passwordStatus === "sending" ? "default" : "pointer",
            opacity: passwordStatus === "sending" ? 0.7 : 1,
          }}
        >
          {passwordStatus === "sending" ? "Signing in…" : "Sign in with password"}
        </button>
      </form>

      <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#4b5563", fontSize: 11 }}>
        <div style={{ flex: 1, height: 1, background: "#334155" }} />
        or
        <div style={{ flex: 1, height: 1, background: "#334155" }} />
      </div>

      {linkStatus === "sent" ? (
        <div style={{ color: "#e5e7eb", fontSize: 13, textAlign: "center" }}>
          Check <strong>{email}</strong> for a sign-in link.
        </div>
      ) : (
        <form onSubmit={submitMagicLink} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {linkStatus === "error" && linkError && (
            <div style={{ color: "#f87171", fontSize: 12 }}>{linkError}</div>
          )}
          <button
            type="submit"
            disabled={linkStatus === "sending"}
            style={{
              padding: "8px 10px",
              borderRadius: 4,
              border: "1px solid #334155",
              background: "none",
              color: "#e5e7eb",
              fontWeight: 600,
              fontSize: 14,
              cursor: linkStatus === "sending" ? "default" : "pointer",
              opacity: linkStatus === "sending" ? 0.7 : 1,
            }}
          >
            {linkStatus === "sending" ? "Sending…" : "Send magic link instead"}
          </button>
        </form>
      )}
    </div>
  );
}
