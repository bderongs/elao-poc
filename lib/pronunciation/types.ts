import type { PronunciationResult } from "@/lib/azure-stt";

export interface PronunciationAssessParams {
  audio: ArrayBuffer;
  contentType: string;
  langCode: string;
  /** Live transcript of this turn, when known (e.g. from the conversation UI). */
  referenceText?: string;
  /** The examiner's question the learner was answering, when known. */
  context?: string;
  /** Client-measured WPM fallback, used only when server-side duration is unavailable. */
  clientWpm?: number;
}

export interface PronunciationProvider {
  id: string;
  label: string;
  assess(params: PronunciationAssessParams): Promise<PronunciationResult | null>;
}
