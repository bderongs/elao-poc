"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { isCefrRung, type CefrRung } from "@/lib/cefr-rung";
import { MinimalDebugPanel } from "@/components/DebugPanel";

/** Same read-once-from-window.location pattern as app/page.tsx's own
 *  ?debug=/?level= readers — client-only, no Suspense boundary needed. */
function readDebugParams(): { debug: boolean; level: CefrRung | null } {
  if (typeof window === "undefined") return { debug: false, level: null };
  const sp = new URLSearchParams(window.location.search);
  const level = sp.get("level");
  return { debug: sp.get("debug") === "1", level: isCefrRung(level) ? level : null };
}

/**
 * Mounted once in the root layout so `?debug=1` works on every route, not
 * just the live conversation page. The conversation page ("/") renders its
 * own richer DebugPanel (transcript + ET verdicts) while a session is
 * active, so this component stays out of the way there to avoid a double
 * panel — everywhere else, it shows the minimal title + `?level=` view.
 */
export function GlobalDebugPanel() {
  const pathname = usePathname();
  const [{ debug, level }] = useState(readDebugParams);

  if (!debug || pathname === "/") return null;
  return <MinimalDebugPanel level={level} />;
}
