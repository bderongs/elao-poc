"use client";

import { useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

/**
 * Post-session sign-up CTA: same magic-link mechanism as AdminLoginForm, but
 * on success it redirects through /results-saved?claim=<sessionId> instead of
 * back to "/" — this is a single-page app, so bouncing back to "/" would land
 * on the language picker with no memory of the just-finished session.
 */
export function ClaimResultsForm({ sessionId, light = false }: { sessionId: string; light?: boolean }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("sending");
    setErrorMessage(null);
    const next = `/results-saved?claim=${encodeURIComponent(sessionId)}`;
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

  return (
    <div
      style={
        light
          ? { background: "#FFFFFF", border: "1px solid #E4E0D7", borderRadius: 14, padding: 22 }
          : { background: "#1e293b", border: "1px solid #334155", borderRadius: 10, padding: 18 }
      }
    >
      <div style={{ fontSize: light ? 16 : 14, fontFamily: light ? "'Outfit',sans-serif" : undefined, fontWeight: light ? 500 : 700, color: light ? "#141D33" : "#e5e7eb", marginBottom: 4 }}>
        Envie de garder ce résultat ?
      </div>
      <div style={{ fontSize: light ? 14 : 12, color: light ? "#5A5F6E" : "#94a3b8", marginBottom: 12 }}>
        Créez un compte pour le retrouver plus tard, envoyé par email.
      </div>

      {status === "sent" ? (
        <div style={{ color: light ? "#2F9E6E" : "#4ade80", fontSize: 13 }}>
          Vérifiez vos emails (<strong>{email}</strong>) pour confirmer.
        </div>
      ) : (
        <form onSubmit={submit} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            type="email"
            required
            placeholder="toi@exemple.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{
              flex: "1 1 200px",
              padding: "8px 10px",
              borderRadius: 6,
              border: `1px solid ${light ? "#DDD9D0" : "#334155"}`,
              background: light ? "#F7F5F0" : "#0f172a",
              color: light ? "#141D33" : "#e5e7eb",
              fontSize: 14,
              fontFamily: light ? "'DM Sans',system-ui,sans-serif" : undefined,
            }}
          />
          <button
            type="submit"
            disabled={status === "sending"}
            style={{
              padding: "8px 14px",
              borderRadius: light ? 10 : 6,
              border: "none",
              background: light ? "#141D33" : "#4f46e5",
              color: "#fff",
              fontFamily: light ? "'Outfit',sans-serif" : undefined,
              fontWeight: light ? 500 : 600,
              fontSize: 14,
              cursor: status === "sending" ? "default" : "pointer",
              opacity: status === "sending" ? 0.7 : 1,
              whiteSpace: "nowrap",
            }}
          >
            {status === "sending" ? "Envoi…" : "Recevoir mon résultat"}
          </button>
        </form>
      )}
      {status === "error" && errorMessage && (
        <div style={{ color: light ? "#B3542E" : "#f87171", fontSize: 12, marginTop: 8 }}>{errorMessage}</div>
      )}
    </div>
  );
}
