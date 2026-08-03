import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/current-user";
import { logout } from "@/app/login/actions";
import adminStyles from "@/components/admin.module.css";
import styles from "@/components/dashboard.module.css";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent("/dashboard")}`);

  return (
    <div className={styles.shell}>
      <div className={styles.topbar}>
        <Link href="/dashboard" className={styles.brand}>
          ELAO <span className={styles.brandAccent}>Speaking</span>
        </Link>
        <div className={styles.topbarRight}>
          <span className={styles.userEmail}>{user.email}</span>
          <form action={logout}>
            <button type="submit" className={adminStyles.signOut}>
              Se déconnecter
            </button>
          </form>
        </div>
      </div>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
