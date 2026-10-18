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
 * available, a streaming client (lib/realtime-stt.ts, lib/realtime-stt-gradium.ts)
 * fed via this file's onAudioFrame callback — fired only within an utterance
 * (plus a short pre-roll), so silence and avatar-TTS bleed between
 * utterances never get streamed.
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

import type { CefrZone } from "@/lib/cefr-rung";

export interface TurnVadCallbacks {
  onSpeechStart?: () => void;
  /** spokenMs excludes the trailing silence wait — see lastVoiceMs in finalize(). */
  onSpeechEnd?: (spokenMs: number) => void;
  /** Fires once, per speech segment, when the user keeps talking through BARGE_IN_MS
   *  while the avatar is speaking — the caller's cue to stop TTS immediately. */
  onBargeIn?: () => void;
  /** Streaming STT's audio feed: every buffer from speech start (preceded by
   *  PRE_ROLL_FRAMES of lead-in) until the utterance is finalized, quiet
   *  in-speech buffers included — never the silence/echo between utterances. */
  onAudioFrame?: (float32: Float32Array) => void;
}

/**
 * RMS below this level is considered silence — the starting value, before
 * the noise floor (below) has been learned, and the base for the echo guard.
 * Carried over from whisper-stt.ts, which tuned it against a stream with
 * noiseSuppression ON.
 */
const SILENCE_THRESHOLD = 0.008;
/**
 * Adaptive threshold: speech = NOISE_FLOOR_MULTIPLIER x the learned noise
 * floor, clamped to [MIN_SPEECH_THRESHOLD, MAX_SPEECH_THRESHOLD]. A fixed
 * 0.008 failed on a quiet mic: app/page.tsx's micStreamRef has AGC off, a
 * candidate's voice came in at ~0.01 RMS, frames flickered around the
 * threshold, and every answer was dropped as sub-MIN_SPEECH_MS bursts — the
 * turn never ended until they spoke up (replayed offline, es session
 * 2026-10-08). Their room sat at ~0.0001, so a floor-relative threshold has
 * plenty of margin. The floor drops fast to quiet frames and rises slowly
 * (time constant ~20 s), so pauses between words keep it pinned to the room
 * even mid-answer, while a fan switching on still gets learned.
 */
const NOISE_FLOOR_MULTIPLIER = 4;
const MIN_SPEECH_THRESHOLD = 0.003;
const MAX_SPEECH_THRESHOLD = 0.02;
const NOISE_FLOOR_FALL = 0.3;
const NOISE_FLOOR_RISE = 0.005;
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
 * flagged (via setPauseZone) that the current question is at
 * the Mastery (C2) difficulty zone — see doc/adaptive-levels-plan.md §3.4.
 * A hard C2 question is designed to require real mid-answer thinking, not
 * just retrieval, so a speaker trailing off mid-sentence there deserves more
 * patience before the turn is cut than the default budget gives everyone
 * else. Starting value only — flagged in the plan as needing empirical
 * tuning against real recordings, not a considered constant yet.
 */
const SILENCE_MS_LONG_EXTENDED = 4000;
/*
 * Foundation zone (A1/A2): no SILENCE_MS_SHORT — a short utterance there is
 * as often a hesitant start ("Et ce… [thinking] …und Butter") as a complete
 * "Ja.", and cutting it at 1.2 s sent the fragment as the answer while the
 * rest of it was buffered as the answer to the NEXT question (live DE session
 * 8512818e: three answers in a row cut this way, ~1.7 s pauses).
 */
/** Speech below this duration is treated as a short reply for SILENCE_MS purposes (ms). */
const SHORT_UTTERANCE_MS = 1500;
/** Ignore audio bursts shorter than this — likely background noise/breath (ms). */
const MIN_SPEECH_MS = 400;
/**
 * A segment still under MIN_SPEECH_MS when its silence timer runs out is kept
 * open until this much silence (ms) instead of being dropped, so a run of
 * short bursts close together (quiet or hesitant speech) adds up to one turn
 * rather than each being discarded on its own.
 */
const BURST_MERGE_MS = SILENCE_MS_LONG;
/**
 * How long the user must keep talking over the avatar before onBargeIn
 * fires (ms). Longer than MIN_SPEECH_MS: a barge-in stops the avatar
 * mid-sentence, so it's worth a bit more confidence than "was this a real
 * turn at all" needs, while still reacting well under a second.
 */
const BARGE_IN_MS = 500;
const BUFFER_SIZE = 4096;
/**
 * Audio kept from just BEFORE speech crosses the threshold and replayed into
 * onAudioFrame at speech start (~340 ms at 48 kHz) — a word's soft onset is
 * below threshold, and without it streaming STT dropped first words ("Ich
 * wohne…" → "wohne…", confirmed against Gradium).
 */
const PRE_ROLL_FRAMES = 4;
/**
 * Silence is normally measured from audio frames, so if the browser stops
 * delivering them mid-utterance (window switched away on macOS, context
 * suspended/"interrupted") the silence timer is never armed and the turn
 * never ends. A wall-clock watchdog treats "no frame for FRAME_STALL_MS" as
 * stalled and closes the turn once the usual long budget has passed since
 * the last voiced frame.
 */
const FRAME_STALL_MS = 1000;
const WATCHDOG_INTERVAL_MS = 500;

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
  /** Set by setPauseZone — the difficulty zone of the current question, which picks the silence budgets. */
  private pauseZone: CefrZone = "core";
  /** Learned background level (RMS) — see NOISE_FLOOR_MULTIPLIER. Seeded so the initial threshold is SILENCE_THRESHOLD. */
  private noiseFloor = SILENCE_THRESHOLD / NOISE_FLOOR_MULTIPLIER;
  /** Last PRE_ROLL_FRAMES sub-threshold frames while not speaking (copies — the browser reuses its buffers). */
  private preRoll: Float32Array[] = [];
  /** Timestamp of the last audio frame of any level — see FRAME_STALL_MS. */
  private lastFrameMs = Date.now();
  private watchdog: ReturnType<typeof setInterval> | null = null;

  constructor(stream: MediaStream, callbacks: TurnVadCallbacks) {
    this.cb = callbacks;

    this.audioContext = new AudioContext();
    // Built after awaits in startSession, i.e. outside the click's user
    // activation — iOS Safari can hand it back "suspended", which would mean
    // no onaudioprocess and no turn detection at all. See also resume().
    this.resume();
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
    this.watchdog = setInterval(() => this.checkStalled(), WATCHDOG_INTERVAL_MS);
  }

  /** Ends an open utterance whose audio frames stopped arriving (see
   *  FRAME_STALL_MS). Also called by the page when it becomes visible again,
   *  since background timers can be throttled. */
  checkStalled() {
    if (!this.isSpeaking) return;
    const now = Date.now();
    if (now - this.lastFrameMs < FRAME_STALL_MS) return; // frames flowing — handleAudio's timers own this
    const budget = this.pauseZone === "mastery" ? SILENCE_MS_LONG_EXTENDED : SILENCE_MS_LONG;
    if (now - this.lastVoiceMs >= budget) this.finalize();
  }

  /** Snapshot for logging around visibility changes. */
  getDiagnostics() {
    return {
      contextState: this.audioContext?.state ?? "closed",
      msSinceFrame: Date.now() - this.lastFrameMs,
      isSpeaking: this.isSpeaking,
    };
  }

  /** Tell the VAD the difficulty zone of the current question: Mastery (C2)
   *  gets a longer budget for mid-answer thinking pauses (SILENCE_MS_LONG_EXTENDED),
   *  Foundation (A1/A2) never uses the short-reply budget (see above). */
  setPauseZone(zone: CefrZone) {
    this.pauseZone = zone;
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
    this.lastFrameMs = Date.now();
    const rms = Math.sqrt(float32.reduce((s, v) => s + v * v, 0) / float32.length);
    // Echo guard stays absolute: leaked avatar voice isn't room noise, and
    // learning the floor from it would raise the threshold for no reason.
    if (!this.avatarSpeaking) {
      const rate = rms < this.noiseFloor ? NOISE_FLOOR_FALL : NOISE_FLOOR_RISE;
      this.noiseFloor += (rms - this.noiseFloor) * rate;
    }
    const threshold = this.avatarSpeaking
      ? ECHO_GUARD_THRESHOLD
      : Math.min(MAX_SPEECH_THRESHOLD, Math.max(MIN_SPEECH_THRESHOLD, this.noiseFloor * NOISE_FLOOR_MULTIPLIER));

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
        for (const frame of this.preRoll) this.cb.onAudioFrame?.(frame);
        this.preRoll = [];
      }
      this.cb.onAudioFrame?.(float32);
      if (this.silenceTimer !== null) {
        clearTimeout(this.silenceTimer);
        this.silenceTimer = null;
      }
    } else if (this.isSpeaking) {
      // Quiet frames INSIDE an utterance (soft consonants, word endings,
      // short pauses) are still speech to the recogniser: forward them until
      // finalize(). Only forwarding above-threshold frames handed streaming
      // STT a chopped, gap-less signal.
      this.cb.onAudioFrame?.(float32);
      if (this.silenceTimer === null) {
        const spokenMs = Date.now() - this.speechStartMs;
        const longBudget = this.pauseZone === "mastery" ? SILENCE_MS_LONG_EXTENDED : SILENCE_MS_LONG;
        const silenceMs = spokenMs < SHORT_UTTERANCE_MS && this.pauseZone !== "foundation" ? SILENCE_MS_SHORT : longBudget;
        this.silenceTimer = setTimeout(() => this.onSilenceTimeout(), silenceMs);
      }
    } else {
      this.preRoll.push(float32.slice());
      if (this.preRoll.length > PRE_ROLL_FRAMES) this.preRoll.shift();
    }
  }

  /** Silence budget ran out — finalize, unless the segment is still too short
   *  to count, in which case wait out BURST_MERGE_MS for more speech first. */
  private onSilenceTimeout() {
    this.silenceTimer = null;
    const spokenMs = this.lastVoiceMs - this.speechStartMs;
    const quietMs = Date.now() - this.lastVoiceMs;
    if (spokenMs < MIN_SPEECH_MS && quietMs < BURST_MERGE_MS) {
      this.silenceTimer = setTimeout(() => this.finalize(), BURST_MERGE_MS - quietMs);
      return;
    }
    this.finalize();
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

  /** "J'ai terminé" — the user says their turn is over, whatever the VAD
   *  thinks (background noise keeping it "speaking", or a mic too quiet to
   *  ever cross the threshold). Resets the segment and returns its spoken
   *  duration (0 when no speech was detected); does NOT fire onSpeechEnd —
   *  the caller ends the turn itself. */
  forceEnd(): number {
    if (this.silenceTimer !== null) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    if (this.bargeInTimer !== null) {
      clearTimeout(this.bargeInTimer);
      this.bargeInTimer = null;
    }
    const spokenMs = this.isSpeaking ? Math.max(0, this.lastVoiceMs - this.speechStartMs) : 0;
    this.isSpeaking = false;
    return spokenMs;
  }

  /** The AudioContext's actual sample rate — not necessarily the mic's native
   *  rate, since a MediaStreamAudioSourceNode resamples to the context's rate
   *  (which defaults to the output device's, not the mic's). lib/realtime-stt.ts
   *  needs this to resample onAudioFrame's buffers correctly. */
  /** Un-suspends the analysis context (no-op when already running) — safe to call from any tap handler. */
  resume() {
    // Safari reports "interrupted" (not in the TS lib type) after the page was backgrounded.
    const state = this.audioContext?.state as string | undefined;
    if (state && state !== "running" && state !== "closed") void this.audioContext!.resume().catch(() => {});
  }

  getSampleRate(): number {
    return this.audioContext?.sampleRate ?? 48000;
  }

  stop() {
    if (this.watchdog !== null) {
      clearInterval(this.watchdog);
      this.watchdog = null;
    }
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
