import { VadLab } from "@/components/VadLab";
import { adminColors } from "@/lib/admin-theme";
import styles from "@/components/admin.module.css";

export default function VadLabPage() {
  return (
    <div>
      <h1 className={styles.pageTitle}>VAD lab</h1>
      <div style={{ color: adminColors.muted, fontSize: 13, marginBottom: 20, maxWidth: 640 }}>
        Try background-noise handling without running a session: pick the browser&apos;s mic
        processing, then speak, cough after an answer, play music or close a door, and watch
        when the live turn detector opens and closes a turn. Nothing is saved.
      </div>
      <VadLab />
    </div>
  );
}
