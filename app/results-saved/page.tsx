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
        flexDirection: "column",
        background: "#F7F5F0",
        color: "#141D33",
        fontFamily: "'DM Sans',system-ui,sans-serif",
      }}
    >
      <div style={{ padding: "22px 36px" }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 9 }}>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 3 }}>
            <div style={{ width: 4, height: 10, background: "#F5B921", borderRadius: 1 }} />
            <div style={{ width: 4, height: 17, background: "#F5B921", borderRadius: 1 }} />
            <div style={{ width: 4, height: 23, background: "#F5B921", borderRadius: 1 }} />
          </div>
          <span style={{ fontFamily: "'Outfit',sans-serif", fontSize: 21, fontWeight: 500, letterSpacing: "0.02em", lineHeight: 1 }}>
            ELAO
          </span>
        </div>
      </div>
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 24px 60px" }}>
        <div
          style={{
            width: "100%",
            maxWidth: 400,
            background: "#FFFFFF",
            border: "1px solid #E4E0D7",
            borderRadius: 14,
            padding: 32,
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 14,
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: "50%",
              background: "#FDF0D0",
              border: "1px solid #F0DDA8",
              color: "#8A6410",
              fontSize: 22,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            ✓
          </div>
          <h1 style={{ margin: 0, fontFamily: "'Outfit',sans-serif", fontSize: 28, fontWeight: 400, letterSpacing: "-0.02em" }}>
            Votre compte est prêt
          </h1>
          <p style={{ margin: 0, fontSize: 16, color: "#5A5F6E", lineHeight: 1.55 }}>
            Votre résultat a été sauvegardé. Vous pourrez le retrouver la prochaine fois que vous vous connecterez.
          </p>
          <Link
            href="/dashboard"
            style={{
              marginTop: 8,
              padding: "14px 32px",
              borderRadius: 10,
              background: "#141D33",
              color: "#fff",
              fontFamily: "'Outfit',sans-serif",
              fontWeight: 500,
              fontSize: 17,
              textDecoration: "none",
            }}
          >
            Voir mes sessions
          </Link>
          <Link
            href="/"
            style={{ fontSize: 14, color: "#6B6F7D", borderBottom: "1px solid #C9C4B8", paddingBottom: 2, textDecoration: "none" }}
          >
            Repasser un test
          </Link>
        </div>
      </div>
    </div>
  );
}
