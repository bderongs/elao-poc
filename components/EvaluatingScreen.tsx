"use client";

import { useEffect, useRef, useState } from "react";

interface EvaluatingScreenProps {
  /** Flips true once /api/evaluate + saveSession have both settled (success or failure). */
  done: boolean;
  /** Called exactly once, after the min-visible-duration and completion animation. */
  onDone: () => void;
  labels?: string[];
}

const DEFAULT_LABELS = [
  "ANALYSE EN COURS",
  "ANALYSE DE LA PRONONCIATION",
  "ANALYSE DU VOCABULAIRE",
  "ANALYSE DE LA GRAMMAIRE",
];

const MIN_VISIBLE_MS = 2500;
const LABEL_INTERVAL_MS = 2200;
const CAP_PERCENT = 90;
const COMPLETE_ANIM_MS = 400;

const LOGO = (
  <div style={{ display: "flex", alignItems: "flex-end", gap: 9 }}>
    <div style={{ display: "flex", alignItems: "flex-end", gap: 3 }}>
      <div style={{ width: 4, height: 10, background: "#F5B921", borderRadius: 1 }} />
      <div style={{ width: 4, height: 17, background: "#F5B921", borderRadius: 1 }} />
      <div style={{ width: 4, height: 23, background: "#F5B921", borderRadius: 1 }} />
    </div>
    <span style={{ fontFamily: "'Outfit',sans-serif", fontSize: 21, fontWeight: 500, color: "#141D33", letterSpacing: "0.02em", lineHeight: 1 }}>
      ELAO
    </span>
  </div>
);

/**
 * Full-screen takeover shown while a session is being scored — screen 4
 * ("Fin de l'épreuve / analyse") of the "Salle claire" design
 * (doc/new_design). There is no incremental server-side progress to report
 * (a single /api/evaluate call), so the bar eases toward CAP_PERCENT and only
 * jumps to 100% once the caller flips `done` — with a minimum visible
 * duration so it never just flashes.
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

  const secondsLeft = Math.max(1, Math.round(((100 - progress) / 100) * 20));

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "#F7F5F0" }}>
      <style>{`
        @keyframes elaoWave { 0%,100% { transform:scaleY(0.28); } 50% { transform:scaleY(1); } }
      `}</style>
      <div style={{ display: "flex", alignItems: "center", padding: "22px 36px" }}>{LOGO}</div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 34, padding: "0 80px 60px" }}>
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
          <h2 style={{ margin: 0, fontFamily: "'Outfit',sans-serif", fontSize: 38, fontWeight: 400, color: "#141D33", letterSpacing: "-0.02em", lineHeight: 1.2 }}>
            C&apos;est terminé, merci.
          </h2>
          <p style={{ margin: 0, fontSize: 17, color: "#5A5F6E", lineHeight: 1.6 }}>
            Nous analysons votre prise de parole : prononciation, fluidité, vocabulaire et grammaire. Votre
            niveau CECRL s&apos;affichera dans un instant.
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
            <span>{done ? "TERMINÉ" : `~${secondsLeft} S`}</span>
          </div>
        </div>
        <span style={{ fontSize: 14, color: "#8A8F9C" }}>
          Vous pouvez fermer cette fenêtre : le rapport vous sera envoyé par e-mail.
        </span>
      </div>
    </div>
  );
}
