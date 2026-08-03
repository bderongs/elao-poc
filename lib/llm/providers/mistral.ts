import { mistralComplete, mistralModel } from "@/lib/mistral";
import type { LlmProvider } from "../types";

export const mistralProvider: LlmProvider = {
  id: "mistral",
  label: "Mistral",
  defaultModel: mistralModel(),
  async complete(params) {
    return mistralComplete({ ...params, context: "eval-lab" });
  },
};
