import { LoginForm } from "@/components/LoginForm";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next = "/dashboard" } = await searchParams;

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
          width: 320,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <h1 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Se connecter</h1>
        <p style={{ fontSize: 13, color: "#94a3b8", margin: 0 }}>
          Reçois un lien de connexion par email, sans mot de passe.
        </p>
        <LoginForm next={next} />
      </div>
    </div>
  );
}
