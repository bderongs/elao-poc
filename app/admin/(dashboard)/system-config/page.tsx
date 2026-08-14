import { getSystemConfig } from "@/lib/system-config";
import { ProviderConfigTable } from "@/components/ProviderConfigTable";
import styles from "@/components/admin.module.css";

export const dynamic = "force-dynamic";

export default function SystemConfigPage() {
  const config = getSystemConfig();

  return (
    <div>
      <h1 className={styles.pageTitle}>System configuration</h1>
      <div style={{ color: "#9ca3af", fontSize: 13, marginBottom: 20, maxWidth: 620 }}>
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
    </div>
  );
}
