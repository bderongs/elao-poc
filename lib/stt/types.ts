export interface SttTranscribeParams {
  audio: ArrayBuffer;
  contentType: string;
  filename: string;
  langCode: string;
  /** H-01 latency-instrumentation id (app/page.tsx's turnLogId, e.g. "turn-1") —
   *  threaded through so this call's logs (labeled STT{n}, see lib/turn-labels.ts)
   *  are correlatable with the rest of that turn's timeline. */
  turnLogId?: string;
}

export interface SttResult {
  text: string;
  wpm: number;
}

export interface SttProvider {
  id: string;
  label: string;
  /** Human-readable model identifier, shown in the admin system-config page and per-session records. */
  modelLabel: string;
  transcribe(params: SttTranscribeParams): Promise<SttResult>;
}
