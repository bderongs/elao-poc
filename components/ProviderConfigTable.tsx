import { Fragment } from "react";
import type { CapabilityConfig } from "@/lib/system-config";
import { FLUENCY_WPM_BANDS, FLUENCY_WPM_HARD_BOUNDARIES } from "@/lib/cefr-prompt";
import styles from "@/components/admin.module.css";

const LANGUAGE_LABELS: Record<string, string> = {
  en: "English", fr: "Français", "nl-BE": "Nederlands (BE)", es: "Español", it: "Italiano", de: "Deutsch",
};

// Shown as a hover tooltip on the CEFR_EVAL row — this is the only step
// where the WPM → fluency bands (lib/cefr-prompt.ts) apply.
function FluencyWpmTooltip() {
  return (
    <span className={styles.tooltipWrap}>
      <span className={styles.tooltipIcon} tabIndex={0}>
        i
      </span>
      <span className={styles.tooltipBox}>
        <div className={styles.tooltipTitle}>WPM → fluency bands</div>
        {FLUENCY_WPM_BANDS.map((b) => (
          <div key={b.range} className={styles.tooltipRow}>
            <span>{b.range} wpm</span>
            <span>fluency {b.fluency}</span>
          </div>
        ))}
        <div className={styles.tooltipHint}>
          Hard floor: &lt; {FLUENCY_WPM_HARD_BOUNDARIES.lowWpm} wpm → ≤{" "}
          {FLUENCY_WPM_HARD_BOUNDARIES.lowFluencyMax}. Hard ceiling: ≥{" "}
          {FLUENCY_WPM_HARD_BOUNDARIES.highWpm} wpm → ≥{" "}
          {FLUENCY_WPM_HARD_BOUNDARIES.highFluencyMin}.
        </div>
      </span>
    </span>
  );
}

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
                <td data-label="Capability">
                  {c.capabilityLabel}
                  {c.capability === "CEFR_EVAL" && <FluencyWpmTooltip />}
                </td>
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
