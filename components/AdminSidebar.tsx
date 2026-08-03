"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "@/components/admin.module.css";

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  isActive: (pathname: string) => boolean;
}

const ICON_PROPS = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

const NAV_ITEMS: NavItem[] = [
  {
    href: "/admin",
    label: "Sessions",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
      </svg>
    ),
    isActive: (p) =>
      p === "/admin" ||
      (p.startsWith("/admin/") &&
        !p.startsWith("/admin/upload") &&
        !p.startsWith("/admin/import-speechace") &&
        !p.startsWith("/admin/scoring")),
  },
  {
    href: "/admin/upload",
    label: "Upload recording",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M12 16V4M12 4l-4 4M12 4l4 4" />
        <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
      </svg>
    ),
    isActive: (p) => p.startsWith("/admin/upload"),
  },
  {
    href: "/admin/import-speechace",
    label: "Import Speechace",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M21 12a9 9 0 1 1-3-6.7" />
        <path d="M21 3v6h-6" />
      </svg>
    ),
    isActive: (p) => p.startsWith("/admin/import-speechace"),
  },
  {
    href: "/admin/scoring",
    label: "Scoring guide",
    icon: (
      <svg {...ICON_PROPS}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 16v-4M12 8h.01" />
      </svg>
    ),
    isActive: (p) => p.startsWith("/admin/scoring"),
  },
];

/**
 * Left nav for the admin shell. A client component (not the server-rendered
 * layout) only because highlighting the active link needs usePathname();
 * `logout` is a server action passed down from the layout so the sign-out
 * form still works without this component doing any data access itself.
 */
export function AdminSidebar({ email, logout }: { email: string; logout: () => Promise<void> }) {
  const pathname = usePathname();

  return (
    <aside className={styles.sidebar}>
      <Link href="/admin" className={styles.brand}>
        ELAO <span className={styles.brandAccent}>Admin</span>
      </Link>

      <nav className={styles.sidebarNav}>
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`${styles.sidebarNavLink} ${item.isActive(pathname) ? styles.sidebarNavLinkActive : ""}`}
          >
            {item.icon}
            {item.label}
          </Link>
        ))}
      </nav>

      <div className={styles.sidebarAccount}>
        <div className={styles.sidebarAccountRow}>
          <div className={styles.sidebarAvatar}>{email[0]?.toUpperCase()}</div>
          <div className={styles.sidebarAccountInfo}>
            <div className={styles.sidebarAccountName}>{email}</div>
            <div className={styles.sidebarAccountMeta}>Admin</div>
          </div>
        </div>
        <form action={logout}>
          <button type="submit" className={styles.signOut}>
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
