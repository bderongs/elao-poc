import { Fragment } from "react";
import type { CapabilityConfig } from "@/lib/system-config";
import { FLUENCY_WPM_BANDS, FLUENCY_WPM_HARD_BOUNDARIES } from "@/lib/cefr-prompt";
import {
  estimateSttCostUsd,
  estimateTtsCostUsd,
  estimateEtCostUsd,
  estimateEoCostUsd,
  estimateCefrEvalCostUsd,
  formatUsd,
  type CostEstimate,
} from "@/lib/session-cost";
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

// Cost per session isn't part of CapabilityConfig itself (lib/system-config.ts
// stays about "what's live", not "what it costs") — computed here, per row,
// from lib/session-cost.ts's estimators.
function costForCapability(c: CapabilityConfig): CostEstimate | null {
  switch (c.capability) {
    case "STT":
      return estimateSttCostUsd(c.providerId);
    case "ET":
      return estimateEtCostUsd(c.providerId, c.modelLabel);
    case "CEFR_EVAL":
      return estimateCefrEvalCostUsd(c.providerId, c.modelLabel);
    case "TTS":
    case "EO":
      return null; // no single number — varies by language, see perLanguage rows
  }
}

// Cost for one language's provider, generalized across every capability that
// can have a perLanguage breakdown (currently TTS and EO) — mirrors
// costForCapability's per-capability dispatch above.
function costForLanguageProvider(capability: CapabilityConfig["capability"], p: { providerId: string; modelLabel: string }): CostEstimate | null {
  switch (capability) {
    case "TTS":
      return estimateTtsCostUsd(p.providerId);
    case "EO":
      return estimateEoCostUsd(p.providerId, p.modelLabel);
    default:
      return null;
  }
}

function blendedPerLanguageCost(
  capability: CapabilityConfig["capability"],
  perLanguage: NonNullable<CapabilityConfig["perLanguage"]>,
): CostEstimate {
  const entries = Object.values(perLanguage);
  const costs = entries.map((p) => costForLanguageProvider(capability, p)?.usdPerSession ?? 0);
  const usdPerSession = costs.reduce((a, b) => a + b, 0) / entries.length;
  return { usdPerSession, note: `Average across ${entries.length} languages' live provider` };
}

// Hover tooltip showing the cost estimate's basis (audio minutes, token
// counts, per-unit price) — same interaction pattern as FluencyWpmTooltip.
function CostCell({ estimate }: { estimate: CostEstimate | null }) {
  if (!estimate) return <td data-label="Est. cost / session">—</td>;
  return (
    <td data-label="Est. cost / session">
      <span className={styles.tooltipWrap}>
        <span tabIndex={0} style={{ cursor: "default", borderBottom: "1px dotted #6b7280" }}>
          {formatUsd(estimate.usdPerSession)}
        </span>
        <span className={styles.tooltipBox} style={{ width: 240 }}>
          {estimate.note}
        </span>
      </span>
    </td>
  );
}

/**
 * Renders a CapabilityConfig[] (lib/system-config.ts) as a table — used both
 * by the admin "System configuration" page (what's live right now) and the
 * admin session-detail page (what a given session actually used), so the two
 * views never visually drift apart.
 */
export function ProviderConfigTable({ config }: { config: CapabilityConfig[] }) {
  const rowCosts = config.map((c) => (c.perLanguage ? blendedPerLanguageCost(c.capability, c.perLanguage) : costForCapability(c)));
  const totalUsd = rowCosts.reduce((sum, c) => sum + (c?.usdPerSession ?? 0), 0);

  return (
    <div className={styles.tableCard}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Capability</th>
            <th>Provider</th>
            <th>Model</th>
            <th>
              Est. cost / session
              <span className={styles.tooltipWrap}>
                <span className={styles.tooltipIcon} tabIndex={0}>
                  i
                </span>
                <span className={styles.tooltipBox} style={{ textTransform: "none", fontWeight: 400 }}>
                  Rough estimate, not a billing reconciliation: current vendor list pricing × average
                  per-session usage (turns, words, audio duration) measured from recent real sessions. Hover
                  a value for its basis.
                </span>
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {config.map((c, i) => (
            <Fragment key={c.capability}>
              <tr>
                <td data-label="Capability">
                  {c.capabilityLabel}
                  {c.capability === "CEFR_EVAL" && <FluencyWpmTooltip />}
                </td>
                <td data-label="Provider">{c.perLanguage ? "Varies by language" : c.providerLabel}</td>
                <td data-label="Model">{c.perLanguage ? "—" : c.modelLabel}</td>
                <CostCell estimate={rowCosts[i]} />
              </tr>
              {c.perLanguage &&
                Object.entries(c.perLanguage).map(([lang, p]) => (
                  <tr key={`${c.capability}-${lang}`}>
                    <td data-label="Capability" style={{ paddingLeft: 24, color: "#9ca3af", fontSize: 13 }}>
                      {LANGUAGE_LABELS[lang] ?? lang}
                    </td>
                    <td data-label="Provider">{p.providerLabel}</td>
                    <td data-label="Model">{p.modelLabel}</td>
                    <CostCell estimate={costForLanguageProvider(c.capability, p)} />
                  </tr>
                ))}
            </Fragment>
          ))}
          <tr>
            <td data-label="Capability" style={{ fontWeight: 700 }}>
              Total (est.)
            </td>
            <td data-label="Provider" />
            <td data-label="Model" />
            <td data-label="Est. cost / session" style={{ fontWeight: 700 }}>
              {formatUsd(totalUsd)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
