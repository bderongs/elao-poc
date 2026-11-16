import Link from "next/link";
import { getCurrentUser } from "@/lib/current-user";
import { AuthPageShell } from "@/components/AuthPageShell";
import { ResetPasswordForm } from "@/components/PasswordResetForms";
import { safeNext } from "@/lib/safe-next";
import { getUiServer } from "@/lib/ui-lang-server";

/**
 * Reached through the emailed reset link: /auth/callback has already logged
 * the user in, so all that's left is choosing the new password. Without a
 * session the link expired (or the page was opened directly).
 */
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const user = await getCurrentUser();
  const { t } = await getUiServer();

  if (!user) {
    return (
      <AuthPageShell title={t.account.expiredTitle} subtitle={t.account.expiredLead}>
        <div style={{ textAlign: "center" }}>
          <Link href="/login/forgot" style={{ color: "#141D33", fontSize: 15 }}>
            {t.account.newLink}
          </Link>
        </div>
      </AuthPageShell>
    );
  }

  return (
    <AuthPageShell title={t.account.resetTitle} subtitle={<>{t.account.resetFor[0]}<strong>{user.email}</strong>{t.account.resetFor[1]}</>}>
      <ResetPasswordForm next={safeNext(next)} />
    </AuthPageShell>
  );
}
