"use client";

import { useState } from "react";
import styles from "./admin.module.css";

export function CollapsibleSection({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div>
      <button type="button" onClick={() => setOpen((o) => !o)} className={styles.collapsibleHeader}>
        <span>{title}</span>
        <span aria-hidden>{open ? "▾" : "▸"}</span>
      </button>
      {open && children}
    </div>
  );
}
