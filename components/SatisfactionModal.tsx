"use client";

import { useEffect, useState } from "react";
import { useUi } from "@/lib/ui-lang";

/** Labels come from the interface dictionary (t.survey.questions), in this order. */
const QUESTIONS = [{ key: "experienceRating" }, { key: "questionsRelevance" }, { key: "gradeRelevance" }] as const;

type RatingKey = (typeof QUESTIONS)[number]["key"];

/**
 * Optional post-assessment satisfaction survey, shown over the results screen
 * (see SessionResultsScreen; gated by NEXT_PUBLIC_SATISFACTION_MODAL). Always
 * dismissible — `onClose` fires on skip, backdrop click, Escape, or shortly
 * after a successful submit. With a null `sessionId` it is a preview
 * (`?survey=1`, see SurveyPreview): submitting sends nothing.
 */
export function SatisfactionModal({ sessionId, onClose }: { sessionId: string | null; onClose: () => void }) {
  const { t } = useUi();
  const [ratings, setRatings] = useState<Partial<Record<RatingKey, number>>>({});
  const [comment, setComment] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (status !== "sent") return;
    const t = setTimeout(onClose, 1800);
    return () => clearTimeout(t);
  }, [status, onClose]);

  const complete = QUESTIONS.every((q) => ratings[q.key] != null);

  const submit = async () => {
    if (!complete || status === "sending") return;
    setStatus("sending");
    if (!sessionId) {
      setStatus("sent");
      return;
    }
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, ...ratings, comment }),
      });
      setStatus(res.ok ? "sent" : "error");
    } catch {
      setStatus("error");
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(20,29,51,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t.survey.aria}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#FFFFFF",
          border: "1px solid #E4E0D7",
          borderRadius: 14,
          padding: 22,
          width: "100%",
          maxWidth: 480,
          maxHeight: "90dvh",
          overflow: "auto",
          fontFamily: "'DM Sans',system-ui,sans-serif",
        }}
      >
        {status === "sent" ? (
          <div style={{ textAlign: "center", padding: "24px 0", color: "#2F9E6E", fontSize: 16 }}>{t.survey.thanks}</div>
        ) : (
          <>
            <div style={{ fontFamily: "'Outfit',sans-serif", fontWeight: 500, fontSize: 18, color: "#141D33", marginBottom: 4 }}>
              {t.survey.title}
            </div>
            <div style={{ fontSize: 14, color: "#5A5F6E", marginBottom: 16 }}>{t.survey.scale}</div>

            {QUESTIONS.map((q, qi) => (
              <div key={q.key} style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 14, color: "#141D33", marginBottom: 8 }}>{t.survey.questions[qi]}</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(10, 1fr)", gap: 4 }}>
                  {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
                    const selected = ratings[q.key] === n;
                    return (
                      <button
                        key={n}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => setRatings((r) => ({ ...r, [q.key]: n }))}
                        style={{
                          padding: "10px 0",
                          borderRadius: 8,
                          border: `1px solid ${selected ? "#141D33" : "#DDD9D0"}`,
                          background: selected ? "#141D33" : "#F7F5F0",
                          color: selected ? "#fff" : "#141D33",
                          fontSize: 13,
                          cursor: "pointer",
                        }}
                      >
                        {n}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              maxLength={1000}
              rows={3}
              placeholder={t.survey.comment}
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "11px 12px",
                borderRadius: 10,
                border: "1px solid #DDD9D0",
                background: "#F7F5F0",
                color: "#141D33",
                fontSize: 16,
                fontFamily: "inherit",
                resize: "vertical",
                marginBottom: 12,
              }}
            />

            {status === "error" && (
              <div style={{ color: "#B3542E", fontSize: 12, marginBottom: 8 }}>{t.survey.failed}</div>
            )}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={onClose}
                style={{ padding: "12px 16px", borderRadius: 10, border: "none", background: "transparent", color: "#6B6F7D", fontSize: 14, cursor: "pointer" }}
              >
                {t.survey.skip}
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={!complete || status === "sending"}
                style={{
                  padding: "12px 20px",
                  borderRadius: 10,
                  border: "none",
                  background: "#141D33",
                  color: "#fff",
                  fontFamily: "'Outfit',sans-serif",
                  fontWeight: 500,
                  fontSize: 14,
                  cursor: complete && status !== "sending" ? "pointer" : "default",
                  opacity: complete && status !== "sending" ? 1 : 0.5,
                }}
              >
                {status === "sending" ? t.survey.sending : t.survey.send}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
