import type { ConvLang } from "@/lib/conversation-prompts";

export interface TtsSynthesizeParams {
  text: string;
  language: ConvLang;
  /** Speaking-rate SSML value (e.g. "-16%") — only honored by providers that
   *  support rate control. Mistral's endpoint rejects a speed param entirely
   *  (verified live, 422), so mistral.ts's synthesize() ignores this. */
  rate: string;
  /** H-01 latency-instrumentation id, threaded through for log correlation
   *  (see lib/turn-labels.ts's chatProcessLabel — TTS speaks the same reply
   *  that label identifies, so it reuses A{n} rather than a new label kind). */
  turnLogId?: string;
}

export interface TtsProvider {
  id: string;
  label: string;
  /** Human-readable model identifier, shown in the admin system-config page and per-session records. */
  modelLabel: string;
  /** Which voice this provider speaks a given language with — for admin display. */
  voiceLabel(language: ConvLang): string;
  synthesize(params: TtsSynthesizeParams): Promise<ReadableStreamDefaultReader<Uint8Array> | null>;
}
