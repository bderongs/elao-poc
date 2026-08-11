"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { computeSessionMainScore, sessionScoreBreakdown } from "@/lib/cefr-score";
import { wordColor, Bar } from "@/components/ScoreDisplay";
import type { SessionSummary } from "@/lib/types";
import styles from "@/components/admin.module.css";

const SOURCE_LABEL: Record<string, string> = {
  cefr: "our CEFR assessment",
  speechace: "Speechace",
  pronunciation: "pronunciation engine",
};

// Grace period between leaving the badge/popover and actually closing, so
// moving the mouse from one to the other (there's a gap between them) doesn't
// flicker shut. Click still works as an immediate open/close, for touch.
const CLOSE_DELAY_MS = 150;

/**
 * Session list "Score" cell: one headline badge, plus every other score we
 * hold on hover (or click, for touch). The popover is portaled to <body> and
 * positioned with `fixed` + measured coordinates rather than `absolute`
 * inside the cell, because the session table's wrapper scrolls
 * (`overflow-x: auto`) and would otherwise clip it.
 *
 * No full-screen backdrop for click-outside-to-close: a fixed, inset:0
 * backdrop would paint on top of the trigger button the instant it mounts
 * (it's appended later in the DOM, portaled to <body>), which steals the
 * hover right back off the button and closes the popover the moment it
 * opens. Click-outside is instead a plain document listener that ignores
 * clicks inside the button or the popover itself.
 */
export function SessionScoreCell({ session }: { session: SessionSummary }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const main = computeSessionMainScore(session);
  const groups = sessionScoreBreakdown(session);
  const hasMore = groups.length > 0;

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);

    const handleOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      close();
    };
    document.addEventListener("mousedown", handleOutside);

    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      document.removeEventListener("mousedown", handleOutside);
    };
  }, [open]);

  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  if (!main) return <span style={{ color: "#6b7280" }}>—</span>;

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  };

  const openNow = () => {
    if (!hasMore) return;
    cancelClose();
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      setCoords({ top: rect.bottom + 6, left: Math.min(rect.left, window.innerWidth - 236) });
    }
    setOpen(true);
  };

  const toggle = () => {
    if (!hasMore) return;
    if (open) setOpen(false);
    else openNow();
  };

  return (
    <div className={styles.scoreCell}>
      <button
        ref={buttonRef}
        type="button"
        className={styles.scoreBadgeButton}
        style={{ background: wordColor(main.score) }}
        title={hasMore ? undefined : `${main.level} · ${main.score}/100 (${SOURCE_LABEL[main.source]})`}
        onClick={toggle}
        onMouseEnter={openNow}
        onMouseLeave={scheduleClose}
        disabled={!hasMore}
      >
        {main.level} <span className={styles.scoreBadgeNumber}>{main.score}</span>
      </button>

      {open &&
        createPortal(
          <div
            ref={popoverRef}
            className={styles.scorePopover}
            style={{ top: coords.top, left: coords.left }}
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
          >
            {groups.map((g) => (
              <div key={g.title} className={styles.scorePopoverGroup}>
                <div className={styles.scorePopoverGroupTitle}>{g.title}</div>
                {g.rows.map((r) => (
                  <Bar key={r.label} label={r.label} value={r.value} max={r.max} />
                ))}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
