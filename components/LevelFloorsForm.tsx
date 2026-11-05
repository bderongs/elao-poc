"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_LEVEL_FLOORS, EDITABLE_LEVELS, SCORED_LEVELS, type LevelFloors } from "@/lib/cefr-score";
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

const buttonStyle = (primary: boolean, pending: boolean): React.CSSProperties => ({
  padding: "6px 10px",
  borderRadius: 4,
  border: primary ? "none" : `1px solid ${adminColors.border}`,
  background: primary ? adminColors.ink : "transparent",
  color: primary ? "#fff" : adminColors.ink,
  fontWeight: 600,
  fontSize: 12,
  cursor: pending ? "default" : "pointer",
  opacity: pending ? 0.6 : 1,
});

/**
 * Editable score → level cut-offs for /admin/settings (lib/cefr-score.ts's
 * LevelFloors, scoring_settings) — same pattern as IntegritySettingsForm:
 * local edit state, PATCH via fetch, router.refresh() on success.
 */
export function LevelFloorsForm({ initial }: { initial: LevelFloors }) {
  const router = useRouter();
  const [floors, setFloors] = useState<LevelFloors>(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = async (next: LevelFloors) => {
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/scoring-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ levelFloors: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setFloors(data.levelFloors as LevelFloors);
      setSaved(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  };

  // Each level runs from its floor to just below the next one's; A0 is everything under A1.
  const rangeOf = (i: number) => {
    const next = SCORED_LEVELS[i + 1];
    return next === "C2" ? `– 89 (top of the scale)` : `– ${floors[next] - 1}`;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "8px 20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: adminColors.ink }}>
          <span style={{ width: 36, fontWeight: 600 }}>A0</span>
          <span style={{ color: adminColors.muted }}>0 – {floors.A1 - 1}</span>
        </div>
        {EDITABLE_LEVELS.map((level, i) => (
          <label key={level} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: adminColors.ink }}>
            <span style={{ width: 36, fontWeight: 600 }}>{level}</span>
            <input
              type="number"
              min={1}
              max={89}
              step={1}
              value={floors[level]}
              onChange={(e) => setFloors({ ...floors, [level]: Number(e.target.value) })}
              style={inputStyle}
            />
            <span style={{ color: adminColors.muted }}>{rangeOf(i)}</span>
            {floors[level] !== DEFAULT_LEVEL_FLOORS[level] && (
              <span style={{ fontSize: 11, color: adminColors.faint }}>(default {DEFAULT_LEVEL_FLOORS[level]})</span>
            )}
          </label>
        ))}
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <button onClick={() => save(floors)} disabled={pending} style={buttonStyle(true, pending)}>
          {pending ? "Saving…" : "Save"}
        </button>
        <button onClick={() => save(DEFAULT_LEVEL_FLOORS)} disabled={pending} style={buttonStyle(false, pending)}>
          Reset to defaults
        </button>
        {saved && <span style={{ fontSize: 12, color: adminColors.success }}>Saved</span>}
        {error && <span style={{ fontSize: 12, color: adminColors.danger }}>{error}</span>}
      </div>
    </div>
  );
}
