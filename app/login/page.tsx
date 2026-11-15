import { LoginForm } from "@/components/LoginForm";
import { AuthPageShell } from "@/components/AuthPageShell";
import { safeNext } from "@/lib/safe-next";
import { getUiServer } from "@/lib/ui-lang-server";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  const { t } = await getUiServer();

  return (
    <AuthPageShell
      title={t.account.signInTitle}
      subtitle={
        error === "link" ? (
          <span style={{ color: "#B3542E" }}>{t.account.linkExpiredLead}</span>
        ) : (
          t.account.signInLead
        )
      }
    >
      <LoginForm next={safeNext(next)} />
    </AuthPageShell>
  );
}
