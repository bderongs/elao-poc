import { AuthPageShell } from "@/components/AuthPageShell";
import { ForgotPasswordForm } from "@/components/PasswordResetForms";
import { safeNext } from "@/lib/safe-next";
import { getUiServer } from "@/lib/ui-lang-server";

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const { t } = await getUiServer();
  return (
    <AuthPageShell title={t.account.forgotTitle} subtitle={t.account.forgotLead}>
      <ForgotPasswordForm next={safeNext(next)} />
    </AuthPageShell>
  );
}
