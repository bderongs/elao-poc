/** Best-effort: ships a client-side event to logs/server-*.log via /api/client-log. Never throws, never blocks the caller. */
export function logClientEvent(event: string, data: Record<string, unknown>) {
  fetch("/api/client-log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event, data }),
  }).catch(() => {});
}
