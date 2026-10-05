"use client";

import { useEffect, useState } from "react";
import { SatisfactionModal } from "@/components/SatisfactionModal";

/**
 * `?survey=1` on any page opens the satisfaction modal in preview mode — to
 * check how it looks. Nothing is sent or stored, and it works whether or not
 * NEXT_PUBLIC_SATISFACTION_MODAL is on. Read after mount (not during render)
 * to avoid a hydration mismatch.
 */
export function SurveyPreview() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setOpen(new URLSearchParams(window.location.search).get("survey") === "1");
  }, []);
  return open ? <SatisfactionModal sessionId={null} onClose={() => setOpen(false)} /> : null;
}
