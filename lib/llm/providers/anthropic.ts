import Anthropic from "@anthropic-ai/sdk";
import type { LlmProvider } from "../types";

const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5";

function client(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

// Comparison-only: not used by the live conversation flow (that's Mistral).
// Re-added so the eval lab can measure Mistral's CEFR scoring against the
// model the original prompts were tuned on.
export const anthropicProvider: LlmProvider = {
  id: "anthropic",
  label: "Anthropic Claude",
  defaultModel: DEFAULT_MODEL,
  async complete({ model, system, messages, maxTokens }) {
    const res = await client().messages.create({
      model: model ?? DEFAULT_MODEL,
      max_tokens: maxTokens ?? 1500,
      system,
      messages,
    });
    const block = res.content[0];
    return block?.type === "text" ? block.text : "";
  },
};
