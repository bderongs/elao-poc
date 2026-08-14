/**
 * Client-side turn-boundary detection (energy-based VAD).
 *
 * Replaces the role Azure's streaming recognizer used to play in
 * lib/azure-stt.ts: deciding when the user has stopped talking. Now that
 * transcription is a Voxtral batch call (lib/mistral.ts's mistralTranscribe,
 * via app/api/transcribe) rather than a live streaming one, something has to
 * decide when to stop recording and send the clip — that's this file's only
 * job. It does NOT transcribe, record, or encode audio itself; app/page.tsx's
 * existing startTurnRecording/stopTurnRecording (MediaRecorder) and the new
 * transcribe call still own that. No live-partial-text callback either —
 * live captions are gone along with Azure; app/page.tsx shows a "…"
 * listening indicator between onSpeechStart and the transcript arriving.
 *
 * Adapted from the RMS-threshold logic in the retired lib/whisper-stt.ts
 * (same SILENCE_MS/MIN_SPEECH_MS starting points), stripped down to pure
 * detection — that file also accumulated PCM, encoded WAV, and called a
 * Whisper endpoint itself.
 *
 * Taps an EXISTING MediaStream (passed in) rather than opening its own
 * getUserMedia, unlike both AzureSTT and WhisperSTT — app/page.tsx already
 * has a dedicated, fidelity-tuned mic stream (micStreamRef) for turn
 * recording, so there's no need for a second one.
 */

export interface TurnVadCallbacks {
  onSpeechStart?: () => void;
  onSpeechEnd?: () => void;
}

/**
 * RMS below this level is considered silence. Carried over from
 * whisper-stt.ts, which tuned it against a stream with noiseSuppression ON.
 * app/page.tsx's micStreamRef has noiseSuppression/AGC deliberately OFF (for
 * pronunciation-assessment fidelity), so this may need re-tuning against
 * real background noise once tested live.
 */
const SILENCE_THRESHOLD = 0.008;
/**
 * While the avatar's own TTS is playing, browser echoCancellation is the
 * only thing keeping its voice out of this mic stream, and it isn't perfect
 * (especially right as it's converging, e.g. at the very start of a
 * session). A quiet leak of the avatar's own voice was observed crossing
 * SILENCE_THRESHOLD and getting transcribed as a phantom user turn. Genuine
 * barge-in (the user actually talking over the avatar) is much louder at
 * the mic than leaked speaker bleed, so require a much stronger signal
 * while the avatar is speaking rather than disabling detection outright.
 */
const ECHO_GUARD_THRESHOLD = SILENCE_THRESHOLD * 4;
/** How long to keep the echo guard up after the avatar stops speaking, to cover room-echo decay tail (ms). */
const ECHO_GUARD_TAIL_MS = 400;
/**
 * How long silence must persist before a turn is considered finished (ms).
 * Was 1500 — real sessions showed mid-sentence thinking pauses (a speaker
 * trailing off with "...and I think" before continuing, especially common
 * when searching for words in a non-native language) getting finalized as a
 * complete turn well before the speaker meant to stop. Raised to give
 * genuine hesitation room; still short enough not to make the examiner feel
 * unresponsive once the speaker actually is done.
 */
const SILENCE_MS = 2500;
/** Ignore audio bursts shorter than this — likely background noise/breath (ms). */
const MIN_SPEECH_MS = 400;
const BUFFER_SIZE = 4096;

export class TurnVad {
  private audioContext: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private cb: TurnVadCallbacks;

  private isSpeaking = false;
  private speechStartMs = 0;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private avatarSpeaking = false;
  private avatarGuardTailTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(stream: MediaStream, callbacks: TurnVadCallbacks) {
    this.cb = callbacks;

    this.audioContext = new AudioContext();
    this.source = this.audioContext.createMediaStreamSource(stream);
    this.processor = this.audioContext.createScriptProcessor(BUFFER_SIZE, 1, 1);
    this.processor.onaudioprocess = (e) => this.handleAudio(e.inputBuffer.getChannelData(0));

    // ScriptProcessorNode only fires onaudioprocess while connected through
    // to a destination — route through a silent gain node so the mic is
    // analysed without actually being played back.
    const silentGain = this.audioContext.createGain();
    silentGain.gain.value = 0;
    this.source.connect(this.processor);
    this.processor.connect(silentGain);
    silentGain.connect(this.audioContext.destination);
  }

  /** Tell the VAD whether the avatar's TTS is currently audible, so it can raise its threshold against echo/bleed-through. */
  setAvatarSpeaking(speaking: boolean) {
    if (speaking) {
      if (this.avatarGuardTailTimer !== null) {
        clearTimeout(this.avatarGuardTailTimer);
        this.avatarGuardTailTimer = null;
      }
      this.avatarSpeaking = true;
    } else if (this.avatarGuardTailTimer === null) {
      this.avatarGuardTailTimer = setTimeout(() => {
        this.avatarGuardTailTimer = null;
        this.avatarSpeaking = false;
      }, ECHO_GUARD_TAIL_MS);
    }
  }

  private handleAudio(float32: Float32Array) {
    const rms = Math.sqrt(float32.reduce((s, v) => s + v * v, 0) / float32.length);
    const threshold = this.avatarSpeaking ? ECHO_GUARD_THRESHOLD : SILENCE_THRESHOLD;

    if (rms > threshold) {
      if (!this.isSpeaking) {
        this.isSpeaking = true;
        this.speechStartMs = Date.now();
        this.cb.onSpeechStart?.();
      }
      if (this.silenceTimer !== null) {
        clearTimeout(this.silenceTimer);
        this.silenceTimer = null;
      }
    } else if (this.isSpeaking && this.silenceTimer === null) {
      this.silenceTimer = setTimeout(() => this.finalize(), SILENCE_MS);
    }
  }

  private finalize() {
    this.silenceTimer = null;
    const spoke = this.isSpeaking && Date.now() - this.speechStartMs >= MIN_SPEECH_MS;
    this.isSpeaking = false;
    if (spoke) this.cb.onSpeechEnd?.();
  }

  stop() {
    if (this.silenceTimer !== null) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    if (this.avatarGuardTailTimer !== null) {
      clearTimeout(this.avatarGuardTailTimer);
      this.avatarGuardTailTimer = null;
    }
    this.isSpeaking = false;
    this.processor?.disconnect();
    this.processor = null;
    this.source?.disconnect();
    this.source = null;
    this.audioContext?.close();
    this.audioContext = null;
  }
}
