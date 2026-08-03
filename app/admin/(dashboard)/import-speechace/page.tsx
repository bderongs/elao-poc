"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "@/components/admin.module.css";

export default function ImportSpeechacePage() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) {
      setError("Paste a Speechace report URL first.");
      return;
    }
    setImporting(true);
    setError(null);
    try {
      const res = await fetch("/api/sessions/speechace-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      router.push(`/admin/${data.id}`);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
      setImporting(false);
    }
  };

  return (
    <div>
      <h1 className={styles.pageTitle}>Import a Speechace report</h1>
      <div style={{ color: "#9ca3af", fontSize: 13, marginBottom: 20, maxWidth: 480 }}>
        Creates a new session from a Speechace placement report — pulls the session-level
        fluency and pronunciation scores plus every question&apos;s audio, so you can compare
        against our own pronunciation providers on the same recordings.
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
          Report URL
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://speak.speechace.co/placement/report/…/"
            style={{
              padding: "8px 10px",
              borderRadius: 4,
              border: "1px solid #334155",
              background: "#0f172a",
              color: "#e5e7eb",
              fontSize: 14,
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
          {importing ? "Importing…" : "Import & create session"}
        </button>
      </form>
    </div>
  );
}
