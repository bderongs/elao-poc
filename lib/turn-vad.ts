/**
 * Client-side turn-boundary detection (energy-based VAD).
 *
 * Replaces the role Azure's streaming recognizer used to play in
 * lib/azure-stt.ts: deciding when the user has stopped talking. This file
 * does NOT transcribe, record, or encode audio itself — app/page.tsx's
 * startTurnRecording/stopTurnRecording (MediaRecorder, still needed for
 * pronunciation-assessment audio + session recording regardless of STT path)
 * own that, and transcription itself is either a Voxtral batch call
 * (lib/mistral.ts's mistralTranscribe, via app/api/transcribe) or, when
 * available, lib/realtime-stt.ts streaming audio to Mistral's realtime
 * endpoint via this file's onAudioFrame callback — fired only while genuine
 * speech is detected, so neither silence nor avatar-TTS bleed gets streamed.
 * No live-partial-text callback either — live captions are gone along with
 * Azure; app/page.tsx shows a "…" listening indicator between onSpeechStart
 * and the transcript arriving.
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
  /** spokenMs excludes the trailing silence wait — see lastVoiceMs in finalize(). */
  onSpeechEnd?: (spokenMs: number) => void;
  /** Fires once, per speech segment, when the user keeps talking through BARGE_IN_MS
   *  while the avatar is speaking — the caller's cue to stop TTS immediately. */
  onBargeIn?: () => void;
  /** Fires per buffer while genuine speech (above the current threshold) is
   *  detected — lib/realtime-stt.ts's audio feed, so silence/echo bleed
   *  between utterances is never streamed to it. */
  onAudioFrame?: (float32: Float32Array) => void;
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
 * Adaptive: short replies ("oui", "yes", one word) use SILENCE_MS_SHORT so
 * quick answers don't sit waiting; anything longer than SHORT_UTTERANCE_MS
 * of speech uses SILENCE_MS_LONG, which protects mid-sentence thinking
 * pauses (a speaker trailing off with "...and I think" before continuing,
 * especially common when searching for words in a non-native language) —
 * this was a single flat 1500ms before, raised to 2500 to fix the pause
 * problem, which then made short answers feel slow to react to. Splitting
 * it in two keeps both fixed.
 */
const SILENCE_MS_SHORT = 1200;
const SILENCE_MS_LONG = 2500;
/**
 * Same role as SILENCE_MS_LONG, but used instead of it when the caller has
 * flagged (via setExtendedPauseTolerance) that the current question is at
 * the Mastery (C2) difficulty zone — see doc/adaptive-levels-plan.md §3.4.
 * A hard C2 question is designed to require real mid-answer thinking, not
 * just retrieval, so a speaker trailing off mid-sentence there deserves more
 * patience before the turn is cut than the default budget gives everyone
 * else. Starting value only — flagged in the plan as needing empirical
 * tuning against real recordings, not a considered constant yet.
 */
const SILENCE_MS_LONG_EXTENDED = 4000;
/** Speech below this duration is treated as a short reply for SILENCE_MS purposes (ms). */
const SHORT_UTTERANCE_MS = 1500;
/** Ignore audio bursts shorter than this — likely background noise/breath (ms). */
const MIN_SPEECH_MS = 400;
/**
 * How long the user must keep talking over the avatar before onBargeIn
 * fires (ms). Longer than MIN_SPEECH_MS: a barge-in stops the avatar
 * mid-sentence, so it's worth a bit more confidence than "was this a real
 * turn at all" needs, while still reacting well under a second.
 */
const BARGE_IN_MS = 500;
const BUFFER_SIZE = 4096;

export class TurnVad {
  private audioContext: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private cb: TurnVadCallbacks;

  private isSpeaking = false;
  private speechStartMs = 0;
  /** Timestamp of the last buffer that was actually above threshold — used
   *  instead of Date.now() at finalize() time, which would otherwise include
   *  the full trailing silence wait and understate spokenMs/WPM. */
  private lastVoiceMs = 0;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private avatarSpeaking = false;
  private avatarGuardTailTimer: ReturnType<typeof setTimeout> | null = null;
  private bargeInTimer: ReturnType<typeof setTimeout> | null = null;
  private bargeInFired = false;
  /** Set by setExtendedPauseTolerance — true while the current question is at the Mastery (C2) difficulty zone. */
  private extendedPauseTolerance = false;

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

  /** Tell the VAD whether the current question is at the Mastery (C2) difficulty
   *  zone, so mid-answer thinking pauses get a longer silence budget before the
   *  turn is considered finished — see SILENCE_MS_LONG_EXTENDED above. */
  setExtendedPauseTolerance(enabled: boolean) {
    this.extendedPauseTolerance = enabled;
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
      this.lastVoiceMs = Date.now();
      if (!this.isSpeaking) {
        this.isSpeaking = true;
        this.speechStartMs = this.lastVoiceMs;
        this.bargeInFired = false;
        this.cb.onSpeechStart?.();
        // Only arm the barge-in timer against genuinely raised (echo-guard)
        // RMS while the avatar is talking — a stray blip that clears the
        // normal threshold but not the guard never gets here.
        if (this.avatarSpeaking && this.cb.onBargeIn) {
          this.bargeInTimer = setTimeout(() => {
            this.bargeInTimer = null;
            if (this.isSpeaking && !this.bargeInFired) {
              this.bargeInFired = true;
              this.cb.onBargeIn?.();
            }
          }, BARGE_IN_MS);
        }
      }
      this.cb.onAudioFrame?.(float32);
      if (this.silenceTimer !== null) {
        clearTimeout(this.silenceTimer);
        this.silenceTimer = null;
      }
    } else if (this.isSpeaking && this.silenceTimer === null) {
      const spokenMs = Date.now() - this.speechStartMs;
      const longBudget = this.extendedPauseTolerance ? SILENCE_MS_LONG_EXTENDED : SILENCE_MS_LONG;
      const silenceMs = spokenMs < SHORT_UTTERANCE_MS ? SILENCE_MS_SHORT : longBudget;
      this.silenceTimer = setTimeout(() => this.finalize(), silenceMs);
    }
  }

  private finalize() {
    this.silenceTimer = null;
    if (this.bargeInTimer !== null) {
      clearTimeout(this.bargeInTimer);
      this.bargeInTimer = null;
    }
    const spokenMs = this.lastVoiceMs - this.speechStartMs;
    const spoke = this.isSpeaking && spokenMs >= MIN_SPEECH_MS;
    this.isSpeaking = false;
    if (spoke) this.cb.onSpeechEnd?.(spokenMs);
  }

  /** The AudioContext's actual sample rate — not necessarily the mic's native
   *  rate, since a MediaStreamAudioSourceNode resamples to the context's rate
   *  (which defaults to the output device's, not the mic's). lib/realtime-stt.ts
   *  needs this to resample onAudioFrame's buffers correctly. */
  getSampleRate(): number {
    return this.audioContext?.sampleRate ?? 48000;
  }

  stop() {
    if (this.silenceTimer !== null) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    if (this.bargeInTimer !== null) {
      clearTimeout(this.bargeInTimer);
      this.bargeInTimer = null;
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
