import { AuthPageShell } from "@/components/AuthPageShell";
import { ForgotPasswordForm } from "@/components/PasswordResetForms";
import { safeNext } from "@/lib/safe-next";

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <AuthPageShell title="Mot de passe oublié" subtitle="Indiquez votre e-mail, nous vous envoyons un lien pour en choisir un nouveau.">
      <ForgotPasswordForm next={safeNext(next)} />
    </AuthPageShell>
  );
}
