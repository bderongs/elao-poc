export interface LlmCompleteParams {
  model?: string;
  system?: string;
  messages: { role: "user" | "assistant"; content: string }[];
  maxTokens?: number;
  /** Request a JSON-only response, when the provider supports a native mode for it. */
  json?: boolean;
}

export interface LlmProvider {
  id: string;
  label: string;
  defaultModel: string;
  complete(params: LlmCompleteParams): Promise<string>;
}
