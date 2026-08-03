"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./admin.module.css";

/** Appends another recording to an existing session — POST /api/sessions/:id/turns. */
export function AddRecordingButton({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onChange = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("audio", file);
      const res = await fetch(`/api/sessions/${sessionId}/turns`, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      router.refresh();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div style={{ marginTop: 12 }}>
      <label style={{ cursor: uploading ? "default" : "pointer" }}>
        <input
          ref={fileRef}
          type="file"
          accept="audio/*"
          onChange={onChange}
          disabled={uploading}
          style={{ display: "none" }}
        />
        <span className={styles.runButton} style={{ display: "inline-block", opacity: uploading ? 0.6 : 1 }}>
          {uploading ? "Uploading…" : "+ Add recording"}
        </span>
      </label>
      {error && <div className={styles.errorBox} style={{ marginTop: 8 }}>{error}</div>}
    </div>
  );
}
