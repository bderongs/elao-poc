import { LoginForm } from "@/components/LoginForm";
import { AuthPageShell } from "@/components/AuthPageShell";
import { safeNext } from "@/lib/safe-next";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;

  return (
    <AuthPageShell
      title="Se connecter"
      subtitle={
        error === "link" ? (
          <span style={{ color: "#B3542E" }}>Ce lien a expiré ou a déjà été utilisé. Reconnectez-vous ou demandez un nouveau lien.</span>
        ) : (
          "Connectez-vous ou créez un compte pour retrouver vos sessions."
        )
      }
    >
      <LoginForm next={safeNext(next)} />
    </AuthPageShell>
  );
}
