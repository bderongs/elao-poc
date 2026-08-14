export interface LlmCompleteParams {
  model?: string;
  system?: string;
  messages: { role: "user" | "assistant"; content: string }[];
  maxTokens?: number;
  /** Request a JSON-only response, when the provider supports a native mode for it. */
  json?: boolean;
  /** Label for the log timeline, e.g. "cefr-eval" (live) or "eval-lab" (admin replay). */
  context?: string;
}

export interface LlmProvider {
  id: string;
  label: string;
  /** Human-readable model identifier, shown in the admin system-config page and per-session records. */
  modelLabel: string;
  complete(params: LlmCompleteParams): Promise<string>;
}
