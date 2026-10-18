"use client";

import { AuthForm } from "@/components/AuthForm";

/**
 * Post-session sign-up CTA: on success it navigates to
 * /results-saved?claim=<sessionId>, which ties the just-finished session to
 * the now-logged-in account — this is a single-page app, so going back to
 * "/" would land on the language picker with no memory of the session.
 */
export function ClaimResultsForm({ sessionId, light = false }: { sessionId: string; light?: boolean }) {
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
        Créez un compte (ou connectez-vous) pour le retrouver plus tard.
      </div>
      <AuthForm next={`/results-saved?claim=${encodeURIComponent(sessionId)}`} defaultMode="signup" light={light} />
    </div>
  );
}
