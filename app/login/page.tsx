import { LoginForm } from "@/components/LoginForm";
import { CandidateTopBar } from "@/components/CandidateTopBar";
import styles from "@/components/candidate.module.css";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next = "/dashboard" } = await searchParams;

  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        background: "#F7F5F0",
        color: "#141D33",
        fontFamily: "'DM Sans',system-ui,sans-serif",
      }}
    >
      <CandidateTopBar />
      <div className={styles.centerScreen}>
        <div style={{ width: "100%", maxWidth: 380, display: "flex", flexDirection: "column", alignItems: "center", gap: 20, textAlign: "center" }}>
          <h1 className={styles.titleM} style={{ margin: 0, fontFamily: "'Outfit',sans-serif", fontWeight: 400, letterSpacing: "-0.02em" }}>
            Se connecter
          </h1>
          <p style={{ margin: 0, fontSize: 16, color: "#5A5F6E", lineHeight: 1.55 }}>
            Recevez un lien de connexion par e-mail, sans mot de passe.
          </p>
          <div style={{ width: "100%", boxSizing: "border-box", background: "#FFFFFF", border: "1px solid #E4E0D7", borderRadius: 14, padding: 22, textAlign: "left" }}>
            <LoginForm next={next} />
          </div>
        </div>
      </div>
    </div>
  );
}
