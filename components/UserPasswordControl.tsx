"use client";

import { useState } from "react";

/**
 * Inline "set password" control for the admin Users table — a second,
 * email-free way to provision an account (alongside magic link), since
 * Supabase's auth-email rate limit can block magic links entirely.
 */
export function UserPasswordControl({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<"idle" | "done" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          background: "none",
          border: "none",
          padding: 0,
          fontSize: 13,
          fontWeight: 500,
          color: "#93c5fd",
          textDecoration: "underline",
          cursor: "pointer",
        }}
      >
        Set password
      </button>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setStatus("idle");
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/users/${userId}/password`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setStatus("done");
      setPassword("");
    } catch (e) {
      setStatus("error");
      setErrorMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", gap: 6 }}>
        <input
          type="password"
          required
          minLength={8}
          autoFocus
          placeholder="New password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{
            width: 130,
            padding: "4px 8px",
            borderRadius: 4,
            border: "1px solid #334155",
            background: "#0f172a",
            color: "#e5e7eb",
            fontSize: 12,
          }}
        />
        <button
          type="submit"
          disabled={pending}
          style={{
            padding: "4px 8px",
            borderRadius: 4,
            border: "none",
            background: "#4f46e5",
            color: "#fff",
            fontSize: 12,
            fontWeight: 600,
            cursor: pending ? "default" : "pointer",
          }}
        >
          {pending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setStatus("idle");
            setErrorMessage(null);
          }}
          style={{ background: "none", border: "none", color: "#6b7280", fontSize: 12, cursor: "pointer" }}
        >
          Cancel
        </button>
      </div>
      {status === "done" && <div style={{ fontSize: 11, color: "#4ade80" }}>Password set.</div>}
      {status === "error" && errorMessage && <div style={{ fontSize: 11, color: "#f87171" }}>{errorMessage}</div>}
    </form>
  );
}
