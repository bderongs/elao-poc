"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "@/components/admin.module.css";

export default function UploadRecordingPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [language, setLanguage] = useState("fr");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Choose an audio file first.");
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("audio", file);
      form.set("language", language);
      const res = await fetch("/api/sessions/upload", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      router.push(`/admin/${data.id}`);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
      setUploading(false);
    }
  };

  return (
    <div>
      <h1 className={styles.pageTitle}>Upload a recording</h1>
      <div style={{ color: "#9ca3af", fontSize: 13, marginBottom: 20, maxWidth: 480 }}>
        Creates a new session from a single audio file, so you can run the pronunciation lab
        against any recording — not only one captured through a live conversation.
      </div>

      <form
        onSubmit={submit}
        style={{
          background: "#1e293b",
          border: "1px solid #1e293b",
          borderRadius: 8,
          padding: 20,
          maxWidth: 420,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, color: "#9ca3af" }}>
          Audio file
          <input
            ref={fileRef}
            type="file"
            accept="audio/*"
            style={{ fontSize: 13, color: "#e5e7eb" }}
          />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, color: "#9ca3af" }}>
          Language
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            style={{
              padding: "8px 10px",
              borderRadius: 4,
              border: "1px solid #334155",
              background: "#0f172a",
              color: "#e5e7eb",
              fontSize: 14,
            }}
          >
            <option value="fr">Français</option>
            <option value="en">English</option>
            <option value="nl-BE">Nederlands (BE)</option>
            <option value="es">Español</option>
            <option value="it">Italiano</option>
            <option value="de">Deutsch</option>
          </select>
        </label>

        {error && <div className={styles.errorBox}>{error}</div>}

        <button
          type="submit"
          disabled={uploading}
          style={{
            padding: "8px 10px",
            borderRadius: 4,
            border: "none",
            background: "#4f46e5",
            color: "#fff",
            fontWeight: 600,
            fontSize: 14,
            cursor: uploading ? "default" : "pointer",
            opacity: uploading ? 0.6 : 1,
          }}
        >
          {uploading ? "Uploading…" : "Upload & create session"}
        </button>
      </form>
    </div>
  );
}
