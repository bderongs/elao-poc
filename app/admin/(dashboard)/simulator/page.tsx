import { ConversationSimulator } from "@/components/ConversationSimulator";
import { adminColors } from "@/lib/admin-theme";
import styles from "@/components/admin.module.css";

export default function SimulatorPage() {
  return (
    <div>
      <h1 className={styles.pageTitle}>Conversation simulator</h1>
      <div style={{ color: adminColors.muted, fontSize: 13, marginBottom: 20, maxWidth: 640 }}>
        Runs a text-only session: an AI learner at the chosen CEFR level answers the real examiner
        (same prompts, level steps and topic switching as a live session), then the real CEFR
        evaluation scores the learner&apos;s answers. Nothing is saved.
      </div>
      <ConversationSimulator />
    </div>
  );
}
