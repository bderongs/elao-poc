import { AdminLoginForm } from "@/components/AdminLoginForm";
import { adminColors } from "@/lib/admin-theme";

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next = "/admin", error } = await searchParams;

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: adminColors.sidebarBg,
        color: adminColors.sidebarText,
        fontFamily: "'DM Sans', system-ui, sans-serif",
      }}
    >
      <div
        style={{
          background: adminColors.surface,
          color: adminColors.ink,
          padding: 32,
          borderRadius: 12,
          width: 320,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <h1 style={{ fontFamily: "'Outfit', 'DM Sans', sans-serif", fontSize: 18, fontWeight: 500, margin: 0 }}>ELAO Admin</h1>
        <AdminLoginForm next={next} error={error} />
      </div>
    </div>
  );
}
