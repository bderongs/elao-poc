"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./admin.module.css";

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Compact replacement for the native <audio controls> element, whose default
 * rendering doesn't confine itself well to a small/flexible container —
 * especially noticeable on long session recordings, where it visually
 * dominates and breaks card layouts. Fixed height regardless of duration.
 */
export function AudioPlayer({ src, compact = false }: { src: string; compact?: boolean }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => setCurrent(audio.currentTime);
    const onLoaded = () => setDuration(audio.duration || 0);
    const onEnded = () => setPlaying(false);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onLoaded);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onLoaded);
      audio.removeEventListener("ended", onEnded);
    };
  }, []);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) audio.pause();
    else audio.play();
    setPlaying(!playing);
  };

  const seek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio) return;
    const t = Number(e.target.value);
    audio.currentTime = t;
    setCurrent(t);
  };

  return (
    <div className={compact ? styles.audioPlayerCompact : styles.audioPlayer}>
      <audio ref={audioRef} src={src} preload="metadata" style={{ display: "none" }} />
      <button
        type="button"
        onClick={toggle}
        className={styles.audioPlayButton}
        aria-label={playing ? "Pause" : "Play"}
      >
        {playing ? "❚❚" : "▶"}
      </button>
      <input
        type="range"
        min={0}
        max={duration || 0}
        step={0.1}
        value={current}
        onChange={seek}
        className={styles.audioSeek}
        aria-label="Seek"
      />
      <span className={styles.audioTime}>
        {formatTime(current)} / {formatTime(duration)}
      </span>
    </div>
  );
}
