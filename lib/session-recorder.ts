/**
 * Records the full session (avatar TTS + user mic) for listen-back.
 *
 * Two modes:
 *   new SessionRecorder(combinedStream) — uses the pre-mixed MediaStream
 *     produced by StreamingAudioPlayer.getRecordingStream(). This is the
 *     normal path: both sides of the conversation are captured.
 *   new SessionRecorder() — opens its own getUserMedia as a fallback
 *     (HeyGen mode, or if Deepgram fails to start). Mic-only.
 *
 * Quality: Opus at 128 kbps (AAC in MP4 on Safari — see pickRecorderMimeType). No DSP constraints on the combined stream
 * (echo cancellation / AGC are applied upstream by the mic's getUserMedia).
 */
/**
 * Best MediaRecorder container the browser supports: Opus-in-WebM (best
 * quality/size for speech) where available, else MP4/AAC — the only option
 * on iOS Safari before 18.4. "" when nothing is supported.
 */
export function pickRecorderMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) return "audio/webm;codecs=opus";
  if (MediaRecorder.isTypeSupported("audio/webm")) return "audio/webm";
  if (MediaRecorder.isTypeSupported("audio/mp4")) return "audio/mp4";
  return "";
}

export class SessionRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private stream: MediaStream | null = null;
  /** True when the stream was provided externally (don't stop its tracks on stop). */
  private externalStream: boolean;

  constructor(providedStream?: MediaStream) {
    this.stream = providedStream ?? null;
    this.externalStream = !!providedStream;
  }

  async start(): Promise<void> {
    try {
      if (!this.stream) {
        // Fallback: open a plain mic-only stream.
        // Use audio:true without extra constraints to avoid conflicts with
        // Deepgram's concurrent getUserMedia in the same browser context.
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      }

      const mimeType = pickRecorderMimeType();
      if (!mimeType) {
        console.warn("SessionRecorder: no supported mimeType");
        return;
      }

      this.mediaRecorder = new MediaRecorder(this.stream, {
        mimeType,
        audioBitsPerSecond: 128_000, // 128 kbps — broadcast-quality speech
      });
      this.chunks = [];
      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) this.chunks.push(e.data);
      };
      this.mediaRecorder.start(2000); // chunk every 2 s
    } catch (e) {
      console.warn("SessionRecorder: could not start", e);
    }
  }

  stop(): Promise<Blob | null> {
    return new Promise((resolve) => {
      if (!this.mediaRecorder || this.mediaRecorder.state === "inactive") {
        // Only stop tracks we own (not tracks managed by AudioContext or Deepgram).
        if (!this.externalStream) {
          this.stream?.getTracks().forEach((t) => t.stop());
        }
        resolve(null);
        return;
      }
      this.mediaRecorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: this.mediaRecorder!.mimeType });
        if (!this.externalStream) {
          this.stream?.getTracks().forEach((t) => t.stop());
        }
        resolve(blob.size > 0 ? blob : null);
      };
      this.mediaRecorder.stop();
    });
  }
}
