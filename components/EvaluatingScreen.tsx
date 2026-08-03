"use client";

import { useEffect, useRef, useState } from "react";
import { ThinkingIndicator } from "@/components/ThinkingIndicator";

interface EvaluatingScreenProps {
  /** Flips true once /api/evaluate + saveSession have both settled (success or failure). */
  done: boolean;
  /** Called exactly once, after the min-visible-duration and completion animation. */
  onDone: () => void;
  labels?: string[];
}

const DEFAULT_LABELS = [
  "Analyse de la grammaire…",
  "Analyse du vocabulaire…",
  "Analyse de la prononciation…",
  "Analyse de la fluidité…",
];

const MIN_VISIBLE_MS = 2500;
const LABEL_INTERVAL_MS = 2200;
const CAP_PERCENT = 90;
const COMPLETE_ANIM_MS = 400;

/**
 * Full-screen takeover shown while a session is being scored. There is no
 * incremental server-side progress to report (a single /api/evaluate call),
 * so the bar eases toward CAP_PERCENT and only jumps to 100% once the caller
 * flips `done` — with a minimum visible duration so it never just flashes.
 */
export function EvaluatingScreen({ done, onDone, labels = DEFAULT_LABELS }: EvaluatingScreenProps) {
  const [progress, setProgress] = useState(6);
  const [labelIndex, setLabelIndex] = useState(0);
  const mountedAtRef = useRef(Date.now());
  const firedRef = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    if (done) return;
    const id = setInterval(() => {
      setProgress((p) => (p >= CAP_PERCENT ? p : Math.min(CAP_PERCENT, p + (CAP_PERCENT - p) * 0.15 + 1)));
    }, 200);
    return () => clearInterval(id);
  }, [done]);

  useEffect(() => {
    if (done) return;
    const id = setInterval(() => setLabelIndex((i) => (i + 1) % labels.length), LABEL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [done, labels.length]);

  useEffect(() => {
    if (!done || firedRef.current) return;
    const remaining = Math.max(0, MIN_VISIBLE_MS - (Date.now() - mountedAtRef.current));
    const t1 = setTimeout(() => {
      setProgress(100);
      const t2 = setTimeout(() => {
        if (firedRef.current) return;
        firedRef.current = true;
        onDoneRef.current();
      }, COMPLETE_ANIM_MS);
      return () => clearTimeout(t2);
    }, remaining);
    return () => clearTimeout(t1);
  }, [done]);

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 20,
        background: "#0f172a",
        color: "#f1f5f9",
      }}
    >
      <ThinkingIndicator variant="badge" label={labels[labelIndex]} />
      <div
        style={{
          width: 360,
          maxWidth: "80vw",
          height: 8,
          borderRadius: 999,
          background: "#1e293b",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${progress}%`,
            height: "100%",
            background: "#4f46e5",
            transition: "width 0.3s ease",
            borderRadius: 999,
          }}
        />
      </div>
      <div style={{ fontSize: 12, color: "#64748b", fontFamily: "monospace" }}>{Math.round(progress)}%</div>
    </div>
  );
}
