"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Promote/revoke admin toggle for the admin Users table. Self-demotion is
 * blocked server-side (POST returns an error) since there's no recovery UI
 * once the last admin drops to 'user' — the isSelf+admin case is also
 * disabled here so the failure isn't the first thing the admin sees.
 */
export function UserRoleControl({
  userId,
  role,
  isSelf,
}: {
  userId: string;
  role: "user" | "admin";
  isSelf: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (role === "admin" && isSelf) {
    return <span style={{ fontSize: 12, color: "#4b5563" }}>Can&apos;t revoke your own access</span>;
  }

  const toggle = async () => {
    const nextRole = role === "admin" ? "user" : "admin";
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/users/${userId}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: nextRole }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <div>
      <button
        onClick={toggle}
        disabled={pending}
        style={{
          background: "none",
          border: "none",
          padding: 0,
          fontSize: 13,
          fontWeight: 500,
          color: role === "admin" ? "#f87171" : "#93c5fd",
          textDecoration: "underline",
          cursor: pending ? "default" : "pointer",
        }}
      >
        {pending ? "Saving…" : role === "admin" ? "Revoke admin" : "Make admin"}
      </button>
      {error && <div style={{ marginTop: 4, fontSize: 11, color: "#f87171" }}>{error}</div>}
    </div>
  );
}
