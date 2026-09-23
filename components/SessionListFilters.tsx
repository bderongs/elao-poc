"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { languageLabel, LANGUAGE_CODES } from "@/lib/languages";
import styles from "@/components/admin.module.css";

const SOURCES = ["conversation", "upload", "speechace"];

/**
 * Per-column filter row for the admin session table — lives inside <thead>
 * under the column titles. State is the URL query string (read server-side by
 * app/admin/(dashboard)/page.tsx), so filters survive refresh and can be
 * shared as links. Any change resets to page 1.
 */
export function SessionListFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("page");
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  // Number inputs commit on blur/Enter rather than every keystroke, so typing
  // "15" doesn't navigate for "1" first. Keyed on the URL value so the field
  // resets when "Clear filters" wipes the query string.
  const numberInput = (key: string, placeholder: string) => (
    <input
      key={`${key}-${params.get(key) ?? ""}`}
      type="number"
      min={0}
      inputMode="numeric"
      placeholder={placeholder}
      defaultValue={params.get(key) ?? ""}
      className={styles.filterInput}
      onBlur={(e) => e.target.value !== (params.get(key) ?? "") && set(key, e.target.value)}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
    />
  );

  return (
    <tr className={styles.filterRow}>
      <th>
        <div className={styles.filterStack}>
          <input
            type="date"
            aria-label="From date"
            value={params.get("from") ?? ""}
            onChange={(e) => set("from", e.target.value)}
            className={styles.filterInput}
          />
          <input
            type="date"
            aria-label="To date"
            value={params.get("to") ?? ""}
            onChange={(e) => set("to", e.target.value)}
            className={styles.filterInput}
          />
        </div>
      </th>
      <th>
        <select value={params.get("source") ?? ""} onChange={(e) => set("source", e.target.value)} className={styles.filterInput}>
          <option value="">All</option>
          {SOURCES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </th>
      <th>
        <select value={params.get("lang") ?? ""} onChange={(e) => set("lang", e.target.value)} className={styles.filterInput}>
          <option value="">All</option>
          {LANGUAGE_CODES.map((code) => (
            <option key={code} value={code}>
              {languageLabel(code)}
            </option>
          ))}
        </select>
      </th>
      <th />
      <th>
        <div className={styles.filterStack}>
          {numberInput("minMin", "min (min)")}
          {numberInput("maxMin", "max (min)")}
        </div>
      </th>
      <th>
        <select value={params.get("status") ?? ""} onChange={(e) => set("status", e.target.value)} className={styles.filterInput}>
          <option value="">All</option>
          <option value="completed">Completed</option>
          <option value="unfinished">Not finished</option>
        </select>
      </th>
    </tr>
  );
}
