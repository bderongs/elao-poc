"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { IntegritySettings, LevelBand } from "@/lib/integrity";
import { adminColors } from "@/lib/admin-theme";

const inputStyle: React.CSSProperties = {
  padding: "6px 8px",
  borderRadius: 4,
  border: `1px solid ${adminColors.border}`,
  background: adminColors.bg,
  color: adminColors.ink,
  fontSize: 13,
  width: 64,
};

const rowStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: adminColors.ink };

const BANDS: Array<[LevelBand, string]> = [
  ["A", "A1–A2"],
  ["B", "B1–B2"],
  ["C", "C1–C2"],
];

/**
 * Editable integrity settings card for /admin/settings (lib/integrity.ts,
 * integrity_settings) — same pattern as ConversationSettingsRow: local edit
 * state, PATCH via fetch, router.refresh() on success.
 */
export function IntegritySettingsForm({ initial }: { initial: IntegritySettings }) {
  const router = useRouter();
  const [s, setS] = useState<IntegritySettings>(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/integrity-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(s),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setS(data as IntegritySettings); // out-of-range values come back as the defaults
      setSaved(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  };

  const num = (value: number, onChange: (v: number) => void, step = 1) => (
    <input type="number" min={1} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} style={inputStyle} />
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <label style={rowStyle}>
        <input type="checkbox" checked={s.enabled} onChange={(e) => setS({ ...s, enabled: e.target.checked })} />
        Enabled — record response timing and window changes, mention it on the instructions screen, and show
        the candidate a notice when they come back to the test window
      </label>

      <div style={{ ...rowStyle, flexWrap: "wrap" }}>
        <span style={{ minWidth: 220 }}>Long silence above (seconds), by question level:</span>
        {BANDS.map(([band, label]) => (
          <span key={band} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {label}
            {num(s.silenceThresholdSec[band], (v) => setS({ ...s, silenceThresholdSec: { ...s.silenceThresholdSec, [band]: v } }), 0.5)}
          </span>
        ))}
      </div>

      <div style={rowStyle}>
        <span style={{ minWidth: 220 }}>Silence signal from:</span>
        {num(s.minLongSilences, (v) => setS({ ...s, minLongSilences: v }))} questions with a long silence
      </div>

      <div style={{ ...rowStyle, flexWrap: "wrap" }}>
        <span style={{ minWidth: 220 }}>Window signal from:</span>
        {num(s.minWindowChanges, (v) => setS({ ...s, minWindowChanges: v }))} window changes, or
        {num(s.minAwaySec, (v) => setS({ ...s, minAwaySec: v }))} seconds away in total
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <button
          onClick={save}
          disabled={pending}
          style={{
            padding: "6px 10px",
            borderRadius: 4,
            border: "none",
            background: adminColors.ink,
            color: "#fff",
            fontWeight: 600,
            fontSize: 12,
            cursor: pending ? "default" : "pointer",
            opacity: pending ? 0.6 : 1,
          }}
        >
          {pending ? "Saving…" : "Save"}
        </button>
        {saved && <span style={{ fontSize: 12, color: adminColors.success }}>Saved</span>}
        {error && <span style={{ fontSize: 12, color: adminColors.danger }}>{error}</span>}
      </div>
    </div>
  );
}
