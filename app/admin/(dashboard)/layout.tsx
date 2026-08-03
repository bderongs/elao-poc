import { logout } from "@/app/admin/login/actions";
import { getSupabaseAuthServer } from "@/lib/supabase-auth-server";
import { AdminSidebar } from "@/components/AdminSidebar";
import styles from "@/components/admin.module.css";

export default async function AdminDashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await getSupabaseAuthServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className={styles.shell}>
      <AdminSidebar email={user?.email ?? "Admin"} logout={logout} />
      <main className={styles.main}>{children}</main>
    </div>
  );
}
