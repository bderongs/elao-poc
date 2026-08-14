import { listConversationSettings } from "@/lib/conversation-settings-service";
import { ConversationSettingsRow } from "@/components/ConversationSettingsRow";
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
      <div style={{ color: "#9ca3af", fontSize: 13, marginBottom: 20, maxWidth: 560 }}>
        Controls the live conversation&apos;s adaptive difficulty: the starting CEFR rung for the
        first real question (turn 1 is always a fixed A1 warm-up, unaffected by this), and how
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
                    <span style={{ marginLeft: 8, fontSize: 11, color: "#6b7280" }}>(following default)</span>
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
    </div>
  );
}
