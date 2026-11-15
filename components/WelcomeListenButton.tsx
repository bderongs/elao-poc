"use client";

import { useEffect, useRef, useState } from "react";
import { useUi } from "@/lib/ui-lang";
import { welcomeAudioUrl } from "@/lib/welcome-narration";

/**
 * "Listen to this page" on the welcome screen (roadmap L-05): plays the
 * pre-generated narration in the interface language, never on its own.
 * Hidden when no up-to-date audio exists for the language
 * (lib/welcome-narration.ts). Switching language or leaving the screen stops it.
 */
export function WelcomeListenButton() {
  const { lang, t } = useUi();
  const url = welcomeAudioUrl(lang, t);
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    return () => {
      audio.current?.pause();
      audio.current = null;
      setPlaying(false);
    };
  }, [url]);

  if (!url) return null;

  const toggle = () => {
    if (playing) {
      audio.current?.pause();
      if (audio.current) audio.current.currentTime = 0;
      setPlaying(false);
      return;
    }
    const a = audio.current ?? new Audio(url);
    audio.current = a;
    a.onended = () => setPlaying(false);
    a.onerror = () => setPlaying(false);
    a.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={playing}
      style={{
        display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 14px", borderRadius: 999,
        border: "1px solid #D6D1C4", background: playing ? "#EFEBE2" : "transparent", color: "#141D33",
        fontFamily: "'Outfit',sans-serif", fontSize: 14, cursor: "pointer",
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {playing ? (
          <rect x="6" y="6" width="12" height="12" rx="1.5" />
        ) : (
          <>
            <path d="M11 5 6 9H3v6h3l5 4V5z" />
            <path d="M15.5 8.5a5 5 0 0 1 0 7" />
            <path d="M18.5 5.5a9 9 0 0 1 0 13" />
          </>
        )}
      </svg>
      {playing ? t.welcome.stopListening : t.welcome.listen}
    </button>
  );
}
