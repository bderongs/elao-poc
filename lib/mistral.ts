const MISTRAL_API = "https://api.mistral.ai/v1/chat/completions";

export type MistralRole = "system" | "user" | "assistant";

export interface MistralMessage {
  role: MistralRole;
  content: string;
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

function buildMessages(system: string | undefined, messages: MistralMessage[]): MistralMessage[] {
  const rest = system ? messages.filter((m) => m.role !== "system") : messages;
  return system ? [{ role: "system", content: system }, ...rest] : rest;
}

export async function mistralComplete(params: {
  model?: string;
  system?: string;
  messages: MistralMessage[];
  maxTokens?: number;
  json?: boolean;
}): Promise<string> {
  const res = await fetch(MISTRAL_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: params.model ?? mistralModel(),
      messages: buildMessages(params.system, params.messages),
      max_tokens: params.maxTokens ?? 1500,
      stream: false,
      ...(params.json ? { response_format: { type: "json_object" } } : {}),
    }),
  });

  if (!res.ok) {
    throw new Error(`Mistral API ${res.status}: ${await res.text()}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("Mistral: empty response");
  return content;
}

export async function* mistralStreamText(params: {
  model?: string;
  system?: string;
  messages: MistralMessage[];
  maxTokens?: number;
}): AsyncGenerator<string> {
  const res = await fetch(MISTRAL_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: params.model ?? mistralModel(),
      messages: buildMessages(params.system, params.messages),
      max_tokens: params.maxTokens ?? 300,
      stream: true,
    }),
  });

  if (!res.ok || !res.body) {
    throw new Error(`Mistral API ${res.status}: ${await res.text().catch(() => "")}`);
  }

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
}
