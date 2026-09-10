"use client";

import { useState } from "react";
import Link from "next/link";
import styles from "@/components/admin.module.css";

interface ImportResult {
  url: string;
  id?: string;
  status?: "created" | "repaired" | "skipped";
  error?: string;
}

const STATUS_LABEL: Record<string, string> = {
  created: "Imported",
  repaired: "Repaired (was missing turns)",
  skipped: "Already imported — skipped",
};

export default function ImportSpeechacePage() {
  const [urlsText, setUrlsText] = useState("");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ImportResult[] | null>(null);

  const urls = urlsText
    .split("\n")
    .map((u) => u.trim())
    .filter(Boolean);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!urls.length) {
      setError("Paste at least one Speechace report URL first.");
      return;
    }
    setImporting(true);
    setError(null);
    setResults(null);
    try {
      const res = await fetch("/api/sessions/speechace-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setResults(data.results as ImportResult[]);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setImporting(false);
    }
  };

  return (
    <div>
      <h1 className={styles.pageTitle}>Import Speechace reports</h1>
      <div style={{ color: "#9ca3af", fontSize: 13, marginBottom: 20, maxWidth: 480 }}>
        Creates a new session per Speechace placement report — pulls the session-level
        fluency and pronunciation scores plus every question&apos;s audio, so you can compare
        against our own pronunciation providers on the same recordings. Paste one URL per line
        to import several at once. Safe to re-run with the same list: already-imported
        reports are skipped, and any that only partly imported last time (e.g. a big batch
        got interrupted) are repaired instead of duplicated.
      </div>

      <form
        onSubmit={submit}
        style={{
          background: "#1e293b",
          border: "1px solid #1e293b",
          borderRadius: 8,
          padding: 20,
          maxWidth: 480,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, color: "#9ca3af" }}>
          Report URLs (one per line)
          <textarea
            value={urlsText}
            onChange={(e) => setUrlsText(e.target.value)}
            placeholder={"https://speak.speechace.co/placement/report/…/\nhttps://speak.speechace.co/placement/report/…/"}
            rows={6}
            style={{
              padding: "8px 10px",
              borderRadius: 4,
              border: "1px solid #334155",
              background: "#0f172a",
              color: "#e5e7eb",
              fontSize: 14,
              fontFamily: "inherit",
              resize: "vertical",
            }}
          />
        </label>

        {error && <div className={styles.errorBox}>{error}</div>}

        <button
          type="submit"
          disabled={importing}
          style={{
            padding: "8px 10px",
            borderRadius: 4,
            border: "none",
            background: "#4f46e5",
            color: "#fff",
            fontWeight: 600,
            fontSize: 14,
            cursor: importing ? "default" : "pointer",
            opacity: importing ? 0.6 : 1,
          }}
        >
          {importing
            ? "Importing…"
            : `Import ${urls.length || ""} ${urls.length === 1 ? "URL" : "URLs"}`.trim()}
        </button>
      </form>

      {results && (
        <div style={{ marginTop: 20, maxWidth: 480, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ color: "#9ca3af", fontSize: 13 }}>
            {(["created", "repaired", "skipped"] as const)
              .map((s) => `${results.filter((r) => r.status === s).length} ${STATUS_LABEL[s].split(" (")[0].toLowerCase()}`)
              .concat(`${results.filter((r) => r.error).length} failed`)
              .join(" · ")}
          </div>
          {results.map((r, i) => (
            <div
              key={i}
              style={{
                padding: "8px 12px",
                borderRadius: 6,
                border: `1px solid ${r.error ? "#7f1d1d" : "#166534"}`,
                background: r.error ? "rgba(127, 29, 29, 0.15)" : "rgba(22, 101, 52, 0.15)",
                fontSize: 13,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
              }}
            >
              <span style={{ color: "#9ca3af", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.url}
              </span>
              {r.error ? (
                <span style={{ color: "#f87171", flexShrink: 0 }}>{r.error}</span>
              ) : (
                <span style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                  {r.status && (
                    <span style={{ color: r.status === "skipped" ? "#9ca3af" : "#4ade80", fontSize: 12 }}>
                      {STATUS_LABEL[r.status] ?? r.status}
                    </span>
                  )}
                  <Link href={`/admin/${r.id}`} style={{ color: "#93c5fd" }}>
                    View session →
                  </Link>
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
