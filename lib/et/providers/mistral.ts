import { assessTranscript } from "@/lib/level-assessment";
import { mistralChatModel } from "@/lib/mistral";
import { assessProcessLabel } from "@/lib/turn-labels";
import { logServerEvent } from "@/lib/server-log";
import type { EtProvider, EtAssessParams, EtResult } from "@/lib/et/types";

async function assess(params: EtAssessParams): Promise<EtResult | null> {
  const process = assessProcessLabel("ET", params.turnLogId);
  logServerEvent("et_request_received", { turnLogId: params.turnLogId, process });

  const result = await assessTranscript({ ...params, process });
  if (!result) return null;

  logServerEvent("et_complete", {
    turnLogId: params.turnLogId, process, previousRung: params.currentRung,
    provider: "mistral", model: mistralChatModel(),
    ...result,
  });
  return result;
}

export const mistralEtProvider: EtProvider = {
  id: "mistral",
  label: "Mistral",
  modelLabel: mistralChatModel(),
  assess,
};
