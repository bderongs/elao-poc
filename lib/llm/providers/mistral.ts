import { mistralComplete, mistralModel } from "@/lib/mistral";
import type { LlmProvider } from "../types";

export const mistralProvider: LlmProvider = {
  id: "mistral",
  label: "Mistral",
  modelLabel: mistralModel(),
  async complete(params) {
    return mistralComplete({ ...params, context: params.context ?? "eval-lab" });
  },
};
