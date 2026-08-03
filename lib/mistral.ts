import { acquireMistralSlot, releaseMistralSlot, withMistralSlot } from "@/lib/mistral-queue";
import { logServerEvent } from "@/lib/server-log";

const MISTRAL_API = "https://api.mistral.ai/v1/chat/completions";

export type MistralRole = "system" | "user" | "assistant";

export type MistralContentBlock =
  | { type: "text"; text: string }
  | { type: "input_audio"; input_audio: { data: string; format: string } };

export interface MistralMessage {
  role: MistralRole;
  content: string | MistralContentBlock[];
}

/** Thrown on a non-ok Mistral response — carries enough to decide whether/how long to retry. */
export class MistralHttpError extends Error {
  status: number;
  retryAfterMs: number | null;
  constructor(status: number, retryAfterMs: number | null, message: string) {
    super(message);
    this.name = "MistralHttpError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

function requireApiKey(): string {
  const key = process.env.MISTRAL_API_KEY;
  if (!key) throw new Error("MISTRAL_API_KEY missing");
  return key;
}

export function mistralModel(override?: string): string {
  return override ?? process.env.MISTRAL_MODEL ?? "mistral-large-latest";
}

export function mistralPronunciationModel(): string {
  return (
    process.env.MISTRAL_PRONUNCIATION_MODEL ??
    process.env.MISTRAL_MODEL ??
    "mistral-large-latest"
  );
}

/** Voxtral (audio-input) model — separate family from the text models above. */
export function mistralVoxtralModel(): string {
  return process.env.MISTRAL_VOXTRAL_MODEL ?? "voxtral-small-latest";
}

function buildMessages(system: string | undefined, messages: MistralMessage[]): MistralMessage[] {
  const rest = system ? messages.filter((m) => m.role !== "system") : messages;
  return system ? [{ role: "system", content: system }, ...rest] : rest;
}

// ─── Retry / diagnostics ────────────────────────────────────────────────────
// Rate limits were being hit with zero visibility into WHICH limit (RPS/RPM/
// TPM) and no resilience against transient 429/5xx — this logs everything the
// response gives us and retries a bounded number of times, honoring
// Retry-After when the API sends one.

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 5000;

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function parseRetryAfterMs(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (!Number.isNaN(seconds)) return Math.max(0, seconds * 1000);
  const dateMs = Date.parse(value);
  if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now());
  return null;
}

function backoffDelayMs(attempt: number, retryAfterMs: number | null): number {
  if (retryAfterMs != null) return Math.min(retryAfterMs, 15_000);
  const exp = BASE_DELAY_MS * 2 ** attempt;
  return Math.min(exp + Math.random() * 250, MAX_DELAY_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Logs full diagnostics for a non-ok response and returns the error to throw/retry on. */
async function describeError(
  res: Response,
  context: string,
  meta: { model?: string; attempt: number; willRetry: boolean; durationMs: number }
): Promise<MistralHttpError> {
  const body = await res.text().catch(() => "");
  // Headers are logged wholesale (not cherry-picked) since Mistral's exact
  // rate-limit header names aren't documented anywhere in this codebase.
  const headers = Object.fromEntries(res.headers.entries());
  const retryAfterMs = parseRetryAfterMs(res.headers.get("retry-after"));
  logServerEvent("mistral_error", {
    context,
    ...meta,
    status: res.status,
    retryAfterMs,
    headers,
    body: body.slice(0, 500),
  });
  return new MistralHttpError(res.status, retryAfterMs, `Mistral API ${res.status}: ${body}`);
}

/**
 * POSTs to the chat-completions endpoint with a concurrency slot held and
 * bounded retry on 429/5xx. Used for both the non-streaming call and to
 * establish a streaming connection — retries never apply once SSE bytes have
 * started flowing to a caller (see mistralStreamText).
 *
 * Every attempt is logged (start/success/error) via logServerEvent so a full
 * session's call timeline — including whether two calls' [start, end]
 * windows actually overlapped — is reconstructable from logs/server-*.log
 * after the fact, without needing to watch the terminal live.
 */
async function postWithRetry(body: Record<string, unknown>, context: string): Promise<Response> {
  const model = typeof body.model === "string" ? body.model : undefined;
  let lastError: MistralHttpError | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const startedAt = Date.now();
    logServerEvent("mistral_request_start", { context, model, attempt: attempt + 1, maxAttempts: MAX_ATTEMPTS });

    const res = await fetch(MISTRAL_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${requireApiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      logServerEvent("mistral_request_success", {
        context,
        model,
        attempt: attempt + 1,
        durationMs: Date.now() - startedAt,
      });
      return res;
    }

    const willRetry = isRetryableStatus(res.status) && attempt < MAX_ATTEMPTS - 1;
    const error = await describeError(res, context, {
      model,
      attempt: attempt + 1,
      willRetry,
      durationMs: Date.now() - startedAt,
    });
    if (!willRetry) throw error;
    lastError = error;
    await sleep(backoffDelayMs(attempt, error.retryAfterMs));
  }
  // Unreachable — the loop above always returns or throws.
  throw lastError ?? new Error(`Mistral API: ${context} failed`);
}

export async function mistralComplete(params: {
  model?: string;
  system?: string;
  messages: MistralMessage[];
  maxTokens?: number;
  json?: boolean;
  /** Label for the log timeline, e.g. "pronunciation-judge" or "cefr-eval". */
  context?: string;
}): Promise<string> {
  return withMistralSlot(async () => {
    const res = await postWithRetry(
      {
        model: params.model ?? mistralModel(),
        messages: buildMessages(params.system, params.messages),
        max_tokens: params.maxTokens ?? 1500,
        stream: false,
        ...(params.json ? { response_format: { type: "json_object" } } : {}),
      },
      params.context ?? "complete"
    );

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("Mistral: empty response");
    return content;
  });
}

export async function* mistralStreamText(params: {
  model?: string;
  system?: string;
  messages: MistralMessage[];
  maxTokens?: number;
  /** Label for the log timeline, e.g. "chat". */
  context?: string;
}): AsyncGenerator<string> {
  // Held for the whole streaming lifetime (not just the initial fetch), so
  // acquire/release directly rather than via withMistralSlot's fn-scoped helper.
  await acquireMistralSlot();
  try {
    const res = await postWithRetry(
      {
        model: params.model ?? mistralModel(),
        messages: buildMessages(params.system, params.messages),
        max_tokens: params.maxTokens ?? 300,
        stream: true,
      },
      params.context ?? "stream"
    );

    if (!res.body) throw new Error("Mistral API: empty stream body");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") return;
        try {
          const parsed = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const delta = parsed.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta) yield delta;
        } catch {
          // skip malformed SSE chunk
        }
      }
    }
  } finally {
    releaseMistralSlot();
  }
}
