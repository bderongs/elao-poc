import { listConversationSettings } from "@/lib/conversation-settings-service";
import { ConversationSettingsRow } from "@/components/ConversationSettingsRow";
import { adminColors } from "@/lib/admin-theme";
import styles from "@/components/admin.module.css";

export const dynamic = "force-dynamic";

const LANGUAGE_LABELS: Record<string, string> = {
  default: "Default (all languages)",
  fr: "Français",
  en: "English",
  "nl-BE": "Nederlands (BE)",
  es: "Español",
  it: "Italiano",
  de: "Deutsch",
};

export default async function ConversationSettingsPage() {
  const rows = await listConversationSettings();

  return (
    <div>
      <h1 className={styles.pageTitle}>Conversation settings</h1>
      <div style={{ color: adminColors.muted, fontSize: 13, marginBottom: 20, maxWidth: 560 }}>
        Controls the live conversation&apos;s adaptive difficulty: the starting CEFR rung
        (including turn 1&apos;s opening question, which now follows this setting too — see
        the &ldquo;?level=&rdquo; override below for a per-session way to bypass it), and how
        many rungs a well-handled or struggled answer moves the difficulty. &ldquo;Default&rdquo;
        applies to every language below that doesn&apos;t have its own override.
      </div>

      <div className={styles.tableCard}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Language</th>
              <th>Starting rung</th>
              <th>Step size</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.language}>
                <td data-label="Language">
                  {LANGUAGE_LABELS[row.language] ?? row.language}
                  {row.language !== "default" && !row.isOverridden && (
                    <span style={{ marginLeft: 8, fontSize: 11, color: adminColors.faint }}>(following default)</span>
                  )}
                </td>
                <ConversationSettingsRow
                  language={row.language}
                  startingRung={row.startingRung}
                  stepSize={row.stepSize}
                  isOverridden={row.isOverridden}
                />
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={styles.card} style={{ marginTop: 28, maxWidth: 720 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>URL parameters (dev/testing)</div>
        <div style={{ fontSize: 13, color: adminColors.ink, lineHeight: 1.6 }}>
          <p style={{ margin: "0 0 14px" }}>
            Two query-string flags on the main session page (<code>/</code>) are for testing, not
            end users — neither is linked from the product UI.
          </p>

          <div style={{ marginBottom: 14 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              <code>?level=</code> — direct starting-level mode
            </div>
            <p style={{ margin: "0 0 6px", color: adminColors.muted }}>
              Routes a session straight into a given CEFR rung instead of always starting from the
              per-language default above. Takes any raw rung code: <code>?level=A1</code>,{" "}
              <code>?level=A2</code>, … <code>?level=C2</code>.
            </p>
            <ul style={{ margin: "0 0 6px", paddingLeft: 18, color: adminColors.muted }}>
              <li>Overrides both the opening (turn 1) question&apos;s difficulty and every turn after.</li>
              <li>
                Highest priority in the precedence chain: <code>?level=</code> URL param &gt; a
                signed-in user&apos;s remembered rung (<code>profiles.last_rung</code>) &gt; the
                per-language default set above &gt; hardcoded fallback (A2).
              </li>
              <li>
                Session-start only — the adaptive system (ET) is still free to move the rung up or
                down turn by turn from wherever it started, exactly like a normal session.
              </li>
            </ul>
            <p style={{ margin: 0, color: adminColors.faint }}>
              Example: <code>https://your-domain/?level=C2</code> to route a near-native tester
              straight into the Mastery zone. See <code>doc/adaptive-levels-plan.md</code>.
            </p>
          </div>

          <div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              <code>?debug=1</code> — debug panel
            </div>
            <p style={{ margin: "0 0 6px", color: adminColors.muted }}>
              Shows a live panel fixed to the right edge of the screen during the conversation,
              visible only to whoever loaded the page with this flag — nothing is saved or sent
              anywhere. It displays, updated turn by turn:
            </p>
            <ul style={{ margin: "0 0 6px", paddingLeft: 18, color: adminColors.muted }}>
              <li>The live transcript.</li>
              <li>
                The current CEFR rung and which zone it falls in — Foundation (A1/A2), Core
                (B1–C1), or Mastery (C2).
              </li>
              <li>
                Each answer&apos;s ET verdict (well / adequate / struggled) and the resulting rung
                transition (e.g. A2 → B1), i.e. the reasoning that&apos;s otherwise only visible in
                the server logs.
              </li>
            </ul>
            <p style={{ margin: 0, color: adminColors.faint }}>
              Example: <code>https://your-domain/?level=A1&amp;debug=1</code> — combine with{" "}
              <code>?level=</code> to watch a specific zone&apos;s behaviour end to end. No admin
              auth required to view it, same as <code>?level=</code>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
