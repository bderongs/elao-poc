import { Fragment } from "react";
import type { CapabilityConfig } from "@/lib/system-config";
import styles from "@/components/admin.module.css";

const LANGUAGE_LABELS: Record<string, string> = {
  en: "English", fr: "Français", "nl-BE": "Nederlands (BE)", es: "Español", it: "Italiano", de: "Deutsch",
};

/**
 * Renders a CapabilityConfig[] (lib/system-config.ts) as a table — used both
 * by the admin "System configuration" page (what's live right now) and the
 * admin session-detail page (what a given session actually used), so the two
 * views never visually drift apart.
 */
export function ProviderConfigTable({ config }: { config: CapabilityConfig[] }) {
  return (
    <div className={styles.tableCard}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Capability</th>
            <th>Provider</th>
            <th>Model</th>
          </tr>
        </thead>
        <tbody>
          {config.map((c) => (
            <Fragment key={c.capability}>
              <tr>
                <td data-label="Capability">{c.capabilityLabel}</td>
                <td data-label="Provider">{c.perLanguage ? "Varies by language" : c.providerLabel}</td>
                <td data-label="Model">{c.perLanguage ? "—" : c.modelLabel}</td>
              </tr>
              {c.perLanguage &&
                Object.entries(c.perLanguage).map(([lang, p]) => (
                  <tr key={`${c.capability}-${lang}`}>
                    <td data-label="Capability" style={{ paddingLeft: 24, color: "#9ca3af", fontSize: 13 }}>
                      {LANGUAGE_LABELS[lang] ?? lang}
                    </td>
                    <td data-label="Provider">{p.providerLabel}</td>
                    <td data-label="Model">{p.modelLabel}</td>
                  </tr>
                ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
