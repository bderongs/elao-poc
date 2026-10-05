import { getSystemConfig } from "@/lib/system-config";
import { getScoreCallbackConfig } from "@/lib/score-callback";
import { ProviderConfigTable } from "@/components/ProviderConfigTable";
import { adminColors } from "@/lib/admin-theme";
import styles from "@/components/admin.module.css";

export const dynamic = "force-dynamic";

export default function SystemConfigPage() {
  const config = getSystemConfig();
  const callback = getScoreCallbackConfig();
  const callbackRows: [string, React.ReactNode][] = [
    [
      "Status",
      <span
        key="status"
        style={{
          padding: "2px 8px",
          borderRadius: 100,
          fontSize: 12,
          background: callback.enabled ? "#E3F4EC" : adminColors.warningBg,
          color: callback.enabled ? adminColors.success : adminColors.warning,
        }}
      >
        {callback.enabled ? "Active" : "Not activated"}
      </span>,
    ],
    ["URL", <span key="url"><code>{callback.url}</code>{callback.urlFromEnv ? " (from SCORE_CALLBACK_URL)" : " (default)"}</span>],
    ["Sent when", "A live session is completed with an evaluation (session.completed) — after the save, server-side"],
    ["Payload", "Session id, user id, language, duration, level, score, confidence, the 4 axes (0-100), admin report link"],
    ["Signature", callback.signed ? `HMAC-SHA256 of the body in ${callback.signatureHeader}` : "Not signed (SCORE_CALLBACK_SECRET not set)"],
    ["Delivery", `POST, ${callback.timeoutMs / 1000} s timeout, up to ${callback.maxAttempts} attempts (no retry on 4xx); attempts logged as score_callback_* server events`],
  ];

  const satisfactionEnabled = process.env.NEXT_PUBLIC_SATISFACTION_MODAL === "1";

  return (
    <div>
      <h1 className={styles.pageTitle}>System configuration</h1>
      <div style={{ color: adminColors.muted, fontSize: 13, marginBottom: 20, maxWidth: 620 }}>
        Which provider/model the live conversation is currently using for
        each capability. Read-only — switching a live provider is an
        intentional code change (see the LIVE_..._PROVIDER_ID constant in
        each capability's registry: <code>lib/stt/registry.ts</code>,{" "}
        <code>lib/tts/registry.ts</code>, <code>lib/et/registry.ts</code>,{" "}
        <code>lib/pronunciation-rollup.ts</code>, <code>lib/cefr-eval.ts</code>),
        not something changeable from here. Every completed session records
        its own snapshot of this same table — see that session&apos;s detail
        page for what it actually used.
      </div>

      <ProviderConfigTable config={config} />

      <h2 style={{ fontSize: 16, color: adminColors.ink, margin: "32px 0 4px" }}>Score callback</h2>
      <div style={{ color: adminColors.muted, fontSize: 13, marginBottom: 12, maxWidth: 620 }}>
        Sends each completed session&apos;s score to an external URL. Read-only — configured in{" "}
        <code>lib/score-callback.ts</code> (<code>SCORE_CALLBACK</code>); the URL and signing secret can be set
        per environment with <code>SCORE_CALLBACK_URL</code> / <code>SCORE_CALLBACK_SECRET</code>.
      </div>
      <div className={styles.tableCard}>
        <table className={styles.table}>
          <tbody>
            {callbackRows.map(([label, value]) => (
              <tr key={label}>
                <td style={{ width: 140, color: adminColors.muted }}>{label}</td>
                <td>{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 style={{ fontSize: 16, color: adminColors.ink, margin: "32px 0 4px" }}>Satisfaction survey</h2>
      <div style={{ color: adminColors.muted, fontSize: 13, marginBottom: 12, maxWidth: 620 }}>
        Optional modal on the candidate results screen. Read-only — enabled with{" "}
        <code>NEXT_PUBLIC_SATISFACTION_MODAL=1</code>; answers are shown on each session&apos;s detail page.
      </div>
      <div className={styles.tableCard}>
        <table className={styles.table}>
          <tbody>
            <tr>
              <td style={{ width: 140, color: adminColors.muted }}>Status</td>
              <td>
                <span
                  style={{
                    padding: "2px 8px",
                    borderRadius: 100,
                    fontSize: 12,
                    background: satisfactionEnabled ? "#E3F4EC" : adminColors.warningBg,
                    color: satisfactionEnabled ? adminColors.success : adminColors.warning,
                  }}
                >
                  {satisfactionEnabled ? "Active" : "Not activated"}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
