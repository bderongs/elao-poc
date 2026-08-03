import Link from "next/link";
import { getSupabaseAuthServer } from "@/lib/supabase-auth-server";
import { claimSession } from "@/lib/sessions-service";

/**
 * Landing spot for the post-test sign-up magic link (see
 * components/ClaimResultsForm.tsx) — /auth/callback exchanges the code for a
 * session cookie and redirects here with the just-finished session's id, so
 * it can be tied to the new account before showing a confirmation.
 */
export default async function ResultsSavedPage({
  searchParams,
}: {
  searchParams: Promise<{ claim?: string }>;
}) {
  const { claim } = await searchParams;

  if (claim) {
    const supabase = await getSupabaseAuthServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) await claimSession(claim, user.id);
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0f172a",
        color: "#e5e7eb",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div
        style={{
          background: "#1e293b",
          padding: 32,
          borderRadius: 8,
          width: 360,
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: "50%",
            background: "rgba(74, 222, 128, 0.15)",
            color: "#4ade80",
            fontSize: 24,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto",
          }}
        >
          ✓
        </div>
        <h1 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Ton compte est prêt</h1>
        <p style={{ fontSize: 13, color: "#94a3b8", margin: 0, lineHeight: 1.5 }}>
          Ton résultat a été sauvegardé. Tu pourras le retrouver la prochaine fois que tu te connectes.
        </p>
        <Link
          href="/dashboard"
          style={{
            marginTop: 8,
            padding: "8px 10px",
            borderRadius: 6,
            background: "#4f46e5",
            color: "#fff",
            fontWeight: 600,
            fontSize: 14,
            textDecoration: "none",
          }}
        >
          Voir mes sessions
        </Link>
        <Link
          href="/"
          style={{
            fontSize: 12,
            color: "#94a3b8",
            textDecoration: "underline",
          }}
        >
          Repasser un test
        </Link>
      </div>
    </div>
  );
}
