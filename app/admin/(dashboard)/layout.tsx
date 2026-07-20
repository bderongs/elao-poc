import Link from "next/link";
import { logout } from "@/app/admin/login/actions";
import styles from "@/components/admin.module.css";

export default function AdminDashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link href="/admin" className={styles.brand}>
            ELAO <span className={styles.brandAccent}>Admin</span>
          </Link>
          <nav className={styles.nav}>
            <Link href="/admin" className={styles.navLink}>
              Sessions
            </Link>
          </nav>
          <form action={logout}>
            <button type="submit" className={styles.signOut}>
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
