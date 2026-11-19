"use client";

import { useEffect, useRef, useState } from "react";
import { CandidateTopBar } from "@/components/CandidateTopBar";
import styles from "@/components/candidate.module.css";
import { useUi } from "@/lib/ui-lang";

interface EvaluatingScreenProps {
  /** Flips true once saveSession (which runs the final evaluation) has settled (success or failure). */
  done: boolean;
  /** Called exactly once, after the min-visible-duration and completion animation. */
  onDone: () => void;
  labels?: string[];
  /** Overrides of the speaking test's copy — the written test (/ecrit) passes its own. footnote null = no footnote. */
  title?: string;
  lead?: string;
  footnote?: string | null;
  /** Typical wait, for the "~N S" countdown. The written test's analysis takes about 45 s. */
  expectedSeconds?: number;
}

const MIN_VISIBLE_MS = 2500;
const LABEL_INTERVAL_MS = 2200;
const CAP_PERCENT = 90;
const COMPLETE_ANIM_MS = 400;

/**
 * Full-screen takeover shown while a session is being scored — screen 4
 * ("Fin de l'épreuve / analyse") of the "Salle claire" design
 * (doc/new_design). There is no incremental server-side progress to report
 * (a single save-and-evaluate call), so the bar eases toward CAP_PERCENT and only
 * jumps to 100% once the caller flips `done` — with a minimum visible
 * duration so it never just flashes.
 */
export function EvaluatingScreen({ done, onDone, labels: labelsProp, title, lead, footnote, expectedSeconds = 20 }: EvaluatingScreenProps) {
  const { t } = useUi();
  const labels = labelsProp ?? t.evaluating.labels;
  const [progress, setProgress] = useState(6);
  const [labelIndex, setLabelIndex] = useState(0);
  const mountedAtRef = useRef(Date.now());
  const firedRef = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    if (done) return;
    const id = setInterval(() => {
      // Slower easing for a longer expected wait (the default 20 s keeps the original pace).
      const pace = 20 / expectedSeconds;
      setProgress((p) => (p >= CAP_PERCENT ? p : Math.min(CAP_PERCENT, p + ((CAP_PERCENT - p) * 0.15 + 1) * pace)));
    }, 200);
    return () => clearInterval(id);
  }, [done, expectedSeconds]);

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

  const secondsLeft = Math.max(1, Math.round(((100 - progress) / 100) * expectedSeconds));

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "#F7F5F0" }}>
      <style>{`
        @keyframes elaoWave { 0%,100% { transform:scaleY(0.28); } 50% { transform:scaleY(1); } }
      `}</style>
      <CandidateTopBar langSwitcher={false} />
      <div className={styles.evalBody}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 5, height: 56 }}>
          {[0, 0.15, 0.3, 0.45, 0.6].map((delay) => (
            <div
              key={delay}
              style={{
                width: 7,
                background: "#F5B921",
                borderRadius: 3,
                height: "100%",
                transformOrigin: "bottom",
                animation: "elaoWave 1.5s ease-in-out infinite",
                animationDelay: `${delay}s`,
              }}
            />
          ))}
        </div>
        <div style={{ textAlign: "center", maxWidth: 560, display: "flex", flexDirection: "column", gap: 14 }}>
          <h2 className={styles.titleL} style={{ margin: 0, fontFamily: "'Outfit',sans-serif", fontWeight: 400, color: "#141D33", letterSpacing: "-0.02em", lineHeight: 1.2 }}>
            {title ?? t.evaluating.title}
          </h2>
          <p className={styles.lead} style={{ margin: 0, color: "#5A5F6E", lineHeight: 1.6 }}>
            {lead ?? t.evaluating.lead}
          </p>
        </div>
        <div style={{ width: 420, maxWidth: "100%", display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ height: 4, background: "#E4E0D7", borderRadius: 2, overflow: "hidden" }}>
            <div style={{ width: `${progress}%`, height: "100%", background: "#141D33", transition: "width 0.3s ease" }} />
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontFamily: "'IBM Plex Mono',monospace",
              fontSize: 12,
              color: "#8A8F9C",
              letterSpacing: "0.08em",
            }}
          >
            <span>{labels[labelIndex]}</span>
            <span>{done ? t.evaluating.done : `~${secondsLeft} S`}</span>
          </div>
        </div>
        {footnote !== null && (
          <span style={{ fontSize: 14, color: "#8A8F9C", textAlign: "center" }}>
            {footnote ?? t.evaluating.canClose}
          </span>
        )}
      </div>
    </div>
  );
}
