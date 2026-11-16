import { listProfiles } from "@/lib/test-profiles";
import { TestProfilesEditor } from "@/components/TestProfilesEditor";
import { adminColors } from "@/lib/admin-theme";
import styles from "@/components/admin.module.css";

export const dynamic = "force-dynamic";

/** Client profiles (roadmap phase 3): a client's own questions, asked next to the standard bank. */
export default async function ProfilesPage() {
  const profiles = await listProfiles();
  return (
    <div>
      <h1 className={styles.pageTitle}>Test profiles</h1>
      <div style={{ color: adminColors.muted, fontSize: 13, marginBottom: 20, maxWidth: 680 }}>
        A client&apos;s own questions (Safran…), asked during the conversation next to the standard question bank. A test uses a
        profile when its link carries <code>?profile=&lt;id&gt;</code>.
      </div>
      <TestProfilesEditor initial={profiles} />
    </div>
  );
}
