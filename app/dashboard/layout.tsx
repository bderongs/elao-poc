import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/current-user";
import { logout } from "@/app/login/actions";
import { getUiServer } from "@/lib/ui-lang-server";
import { UiLangSwitcher } from "@/components/UiLangSwitcher";
import styles from "@/components/dashboard.module.css";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent("/dashboard")}`);
  const { t } = await getUiServer();

  return (
    <div className={styles.shell}>
      <div className={styles.topbar}>
        <Link href="/dashboard" className={styles.brand}>
          <span className={styles.logoBars}>
            <span style={{ height: 10 }} />
            <span style={{ height: 17 }} />
            <span style={{ height: 23 }} />
          </span>
          <span className={styles.brandName}>ELAO</span>
        </Link>
        <div className={styles.topbarRight}>
          <UiLangSwitcher />
          <span className={styles.userEmail}>{user.email}</span>
          <form action={logout}>
            <button type="submit" className={styles.signOut}>
              {t.dashboard.signOut}
            </button>
          </form>
        </div>
      </div>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
