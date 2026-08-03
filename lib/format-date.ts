/**
 * Fixed-locale, fixed-timezone date formatting for the admin UI.
 * `toLocaleString()`/`toLocaleTimeString()` with no arguments use the JS
 * runtime's default locale AND local timezone — which differ between the
 * Node server process and the admin's browser, producing a different string
 * for the same timestamp and triggering a React hydration mismatch. Pinning
 * both makes the output identical everywhere, at the cost of not showing the
 * viewer's own local time.
 */
const LOCALE = "en-GB";
const TIME_ZONE = "UTC";

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(LOCALE, { timeZone: TIME_ZONE, dateStyle: "short", timeStyle: "medium" });
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(LOCALE, {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
