import Link from "next/link";
import { getCurrentUser } from "@/lib/current-user";
import { AuthPageShell } from "@/components/AuthPageShell";
import { ResetPasswordForm } from "@/components/PasswordResetForms";
import { safeNext } from "@/lib/safe-next";

/**
 * Reached through the emailed reset link: /auth/callback has already logged
 * the user in, so all that's left is choosing the new password. Without a
 * session the link expired (or the page was opened directly).
 */
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const user = await getCurrentUser();

  if (!user) {
    return (
      <AuthPageShell title="Lien expiré" subtitle="Ce lien de réinitialisation n'est plus valide.">
        <div style={{ textAlign: "center" }}>
          <Link href="/login/forgot" style={{ color: "#141D33", fontSize: 15 }}>
            Demander un nouveau lien
          </Link>
        </div>
      </AuthPageShell>
    );
  }

  return (
    <AuthPageShell title="Nouveau mot de passe" subtitle={<>Pour le compte <strong>{user.email}</strong>.</>}>
      <ResetPasswordForm next={safeNext(next)} />
    </AuthPageShell>
  );
}
