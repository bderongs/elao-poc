import { login } from "./actions";

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
        background: "#0f172a",
        color: "#e5e7eb",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <form
        action={login}
        style={{
          background: "#1e293b",
          padding: 32,
          borderRadius: 8,
          width: 320,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <h1 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>ELAO Admin</h1>
        <input type="hidden" name="next" value={next} />
        <input
          type="password"
          name="password"
          placeholder="Password"
          autoFocus
          style={{
            padding: "8px 10px",
            borderRadius: 4,
            border: "1px solid #334155",
            background: "#0f172a",
            color: "#e5e7eb",
            fontSize: 14,
          }}
        />
        {error === "1" && (
          <div style={{ color: "#f87171", fontSize: 12 }}>Wrong password.</div>
        )}
        {error === "config" && (
          <div style={{ color: "#f87171", fontSize: 12 }}>
            ADMIN_PASSWORD is not set on the server.
          </div>
        )}
        <button
          type="submit"
          style={{
            padding: "8px 10px",
            borderRadius: 4,
            border: "none",
            background: "#4f46e5",
            color: "#fff",
            fontWeight: 600,
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          Sign in
        </button>
      </form>
    </div>
  );
}
