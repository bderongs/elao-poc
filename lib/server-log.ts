import fs from "node:fs";
import path from "node:path";

/**
 * File-based structured logging so server-side events (Mistral call timing,
 * retries, rate-limit errors) survive past a dev-server terminal's scrollback
 * — one JSON line per event in logs/server-YYYY-MM-DD.log, readable directly
 * from disk after a session instead of needing live terminal access.
 * Best-effort only: a logging failure must never break the request it
 * describes, so every file write is wrapped and swallowed on error.
 */

const LOG_DIR = path.join(process.cwd(), "logs");
let dirReady = false;

function ensureLogDir(): void {
  if (dirReady) return;
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  } catch (e) {
    console.warn("[server-log] could not create logs/ dir:", e);
  }
  dirReady = true;
}

function logFilePath(date: Date): string {
  const day = date.toISOString().slice(0, 10); // YYYY-MM-DD — one file per day
  return path.join(LOG_DIR, `server-${day}.log`);
}

/**
 * Appends one structured JSON line and mirrors it to the console (console.error
 * for *_error/*_failed events, console.log otherwise) so `next dev`'s terminal
 * still shows it live.
 */
export function logServerEvent(event: string, data: Record<string, unknown> = {}): void {
  const entry = { ts: new Date().toISOString(), event, ...data };

  if (event.endsWith("_error") || event.endsWith("_failed")) {
    console.error(`[${event}]`, data);
  } else {
    console.log(`[${event}]`, data);
  }

  ensureLogDir();
  try {
    fs.appendFileSync(logFilePath(new Date()), JSON.stringify(entry) + "\n");
  } catch (e) {
    console.warn("[server-log] failed to write log file:", e);
  }
}
