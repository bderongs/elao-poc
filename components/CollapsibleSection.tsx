"use client";

import { useState } from "react";
import styles from "./admin.module.css";

export function CollapsibleSection({
  title,
  defaultOpen = true,
  light = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  /** "light" matches the "Salle claire" design (doc/new_design) — used only by SessionResultsScreen. */
  light?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={light ? undefined : styles.collapsibleHeader}
        style={
          light
            ? {
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                width: "100%",
                background: "none",
                border: "none",
                borderBottom: "1px solid #E4E0D7",
                color: "#5A5F6E",
                fontSize: 14,
                fontFamily: "'DM Sans',system-ui,sans-serif",
                cursor: "pointer",
                padding: "0 0 10px",
                marginBottom: 10,
              }
            : undefined
        }
      >
        <span>{title}</span>
        <span aria-hidden>{open ? "▾" : "▸"}</span>
      </button>
      {open && children}
    </div>
  );
}
