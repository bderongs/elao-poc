import { CandidateTopBar } from "@/components/CandidateTopBar";
import styles from "@/components/candidate.module.css";

/** Centered title + subtitle + white card, shared by the /login/* pages. */
export function AuthPageShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
}) {
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
            {title}
          </h1>
          {subtitle && <p style={{ margin: 0, fontSize: 16, color: "#5A5F6E", lineHeight: 1.55 }}>{subtitle}</p>}
          <div style={{ width: "100%", boxSizing: "border-box", background: "#FFFFFF", border: "1px solid #E4E0D7", borderRadius: 14, padding: 22, textAlign: "left" }}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
