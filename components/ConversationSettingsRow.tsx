"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CefrRung } from "@/lib/cefr-rung";

const RUNGS: CefrRung[] = ["A1", "A2", "B1", "B2", "C1"];

const selectStyle: React.CSSProperties = {
  padding: "6px 8px",
  borderRadius: 4,
  border: "1px solid #334155",
  background: "#0f172a",
  color: "#e5e7eb",
  fontSize: 13,
};

const numberInputStyle: React.CSSProperties = { ...selectStyle, width: 56 };

/**
 * Editable starting-rung + step-size controls for one row of
 * /admin/settings — mirrors components/UserRoleControl.tsx's pattern
 * (local edit state, PATCH via fetch, router.refresh() on success).
 * Renders as three sibling <td>s so it slots directly into the table row
 * after the language <td> in app/admin/(dashboard)/settings/page.tsx.
 */
export function ConversationSettingsRow({
  language,
  startingRung,
  stepSize,
  isOverridden,
}: {
  language: "default" | string;
  startingRung: CefrRung;
  stepSize: number;
  isOverridden: boolean;
}) {
  const router = useRouter();
  const [rung, setRung] = useState<CefrRung>(startingRung);
  const [step, setStep] = useState(stepSize);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/conversation-settings/${language}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startingRung: rung, stepSize: step }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  };

  const resetToDefault = async () => {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/conversation-settings/${language}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <td data-label="Starting rung">
        <select value={rung} onChange={(e) => setRung(e.target.value as CefrRung)} style={selectStyle}>
          {RUNGS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </td>
      <td data-label="Step size">
        <input
          type="number"
          min={1}
          max={4}
          value={step}
          onChange={(e) => setStep(Number(e.target.value))}
          style={numberInputStyle}
        />
      </td>
      <td data-label="">
        <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button
              onClick={save}
              disabled={pending}
              style={{
                padding: "6px 10px",
                borderRadius: 4,
                border: "none",
                background: "#4f46e5",
                color: "#fff",
                fontWeight: 600,
                fontSize: 12,
                cursor: pending ? "default" : "pointer",
                opacity: pending ? 0.6 : 1,
              }}
            >
              {pending ? "Saving…" : "Save"}
            </button>
            {language !== "default" && isOverridden && (
              <button
                onClick={resetToDefault}
                disabled={pending}
                style={{
                  background: "none",
                  border: "none",
                  padding: 0,
                  fontSize: 12,
                  color: "#93c5fd",
                  textDecoration: "underline",
                  cursor: pending ? "default" : "pointer",
                }}
              >
                Reset to default
              </button>
            )}
          </div>
          {error && <div style={{ fontSize: 11, color: "#f87171" }}>{error}</div>}
        </div>
      </td>
    </>
  );
}
