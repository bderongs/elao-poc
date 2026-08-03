import { listUsers } from "@/lib/users-service";
import { getCurrentUser } from "@/lib/current-user";
import { UserRoleControl } from "@/components/UserRoleControl";
import { formatDateTime } from "@/lib/format-date";
import styles from "@/components/admin.module.css";

export const dynamic = "force-dynamic";

type Tab = "all" | "admins" | "test-takers" | "no-activity";

const TABS: { key: Tab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "admins", label: "Admins" },
  { key: "test-takers", label: "Test takers" },
  { key: "no-activity", label: "No activity yet" },
];

// "Test taker" = signed up and has at least one session under their account
// (via /login or the post-session claim flow). "No activity yet" = signed
// up (has a profile row) but hasn't claimed/taken anything — the closest
// thing this schema has to a "requested account" bucket, since there's no
// separate signup-request flow.
function matchesTab(tab: Tab, u: { role: string; sessionCount: number }): boolean {
  if (tab === "admins") return u.role === "admin";
  if (tab === "test-takers") return u.role !== "admin" && u.sessionCount > 0;
  if (tab === "no-activity") return u.role !== "admin" && u.sessionCount === 0;
  return true;
}

export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab: tabParam } = await searchParams;
  const tab: Tab = TABS.find((t) => t.key === tabParam)?.key ?? "all";

  const [users, currentUser] = await Promise.all([listUsers(), getCurrentUser()]);
  const filtered = users.filter((u) => matchesTab(tab, u));

  return (
    <div>
      <h1 className={styles.pageTitle}>Users ({users.length})</h1>

      <div className={styles.tabs}>
        {TABS.map((t) => (
          <a
            key={t.key}
            href={`/admin/users?tab=${t.key}`}
            className={`${styles.tab} ${tab === t.key ? styles.tabActive : ""}`}
          >
            {t.label}
            <span className={styles.tabCount}>{users.filter((u) => matchesTab(t.key, u)).length}</span>
          </a>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className={styles.emptyState}>No users in this view.</div>
      ) : (
        <div className={styles.tableCard}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th>Sessions</th>
                <th>Joined</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id}>
                  <td data-label="Email">{u.email ?? "—"}</td>
                  <td data-label="Role">
                    <span
                      className={styles.badge}
                      style={{
                        background: u.role === "admin" ? "#4f46e5" : "#334155",
                        color: u.role === "admin" ? "#fff" : "#cbd5e1",
                      }}
                    >
                      {u.role}
                    </span>
                  </td>
                  <td data-label="Sessions">{u.sessionCount}</td>
                  <td data-label="Joined">{formatDateTime(u.createdAt)}</td>
                  <td data-label="">
                    <UserRoleControl userId={u.id} role={u.role} isSelf={u.id === currentUser?.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
