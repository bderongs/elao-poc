"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { AzureSTT, type PronunciationResult, type WordScore } from "@/lib/azure-stt";
import { StreamingAudioPlayer } from "@/lib/audio-player";
import { SessionRecorder } from "@/lib/session-recorder";
import { blobToWav16kMono } from "@/lib/audio-wav";
import type { LiveAvatarHandle } from "@/components/LiveAvatar";
import { ThinkingIndicator } from "@/components/ThinkingIndicator";
import { EvaluatingScreen } from "@/components/EvaluatingScreen";
import { SessionResultsScreen } from "@/components/SessionResultsScreen";
import { AuthNavLink } from "@/components/AuthNavLink";
import {
  UserWords,
  UtteranceBadges,
  wordColor,
  type PronunciationAvg,
  type CefrResult,
} from "@/components/ScoreDisplay";

const Avatar = dynamic(
  () => import("@/components/Avatar").then((m) => m.Avatar),
  { ssr: false }
);

const LiveAvatar = dynamic(
  () => import("@/components/LiveAvatar").then((m) => m.LiveAvatar),
  { ssr: false }
);

const USE_HEYGEN = process.env.NEXT_PUBLIC_HEYGEN_ENABLED === "true";

/** Best-effort: ships a client-side failure to logs/server-*.log. Never throws, never blocks the caller. */
function logClientEvent(event: string, data: Record<string, unknown>) {
  fetch("/api/client-log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event, data }),
  }).catch(() => {});
}

type Lang = "fr" | "en" | "nl-BE" | "es" | "it" | "de";

const LANGUAGES: Array<{ code: Lang; label: string; flag: string }> = [
  { code: "fr", label: "Français", flag: "🇫🇷" },
  { code: "en", label: "English", flag: "🇬🇧" },
  { code: "nl-BE", label: "Nederlands (BE)", flag: "🇧🇪" },
  { code: "es", label: "Español", flag: "🇪🇸" },
  { code: "it", label: "Italiano", flag: "🇮🇹" },
  { code: "de", label: "Deutsch", flag: "🇩🇪" },
];

type Msg = {
  role: "user" | "assistant";
  content: string;
  pronunciation?: PronunciationResult; // only on user turns
  audioUrl?: string;                   // per-turn recording URL (set after evaluation)
};

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Home() {
  const [language, setLanguage] = useState<Lang>("fr");
  const [sessionStarted, setSessionStarted] = useState(false);
  const [history, setHistory] = useState<Msg[]>([]);
  const [partialUser, setPartialUser] = useState("");
  const [streamingAssistant, setStreamingAssistant] = useState("");
  const [amplitude, setAmplitude] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [cefrResult, setCefrResult] = useState<CefrResult | null>(null);
  /** "active": conversation + single end button. "evaluating": full-screen takeover. "done": results. */
  const [phase, setPhase] = useState<"active" | "evaluating" | "done">("active");
  /** Flips once /api/evaluate + saveSession have both settled (success or failure). */
  const [evalDone, setEvalDone] = useState(false);
  /** True only if /api/evaluate itself errored — session is still saved either way. */
  const [evalFailed, setEvalFailed] = useState(false);
  /** Id returned by POST /api/sessions, once the save succeeds — lets the results screen offer claiming the session on sign-up. */
  const [savedSessionId, setSavedSessionId] = useState<string | null>(null);
  /** True while waiting on the avatar's reply — from end-of-speech until the first reply token streams in. */
  const [isThinking, setIsThinking] = useState(false);
  /** Set when /api/chat fails outright (after retries) so the user isn't left staring at silence. */
  const [chatError, setChatError] = useState<string | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const audioBlobUrlRef = useRef<string | null>(null);

  const sttRef = useRef<AzureSTT | null>(null);
  const playerRef = useRef<StreamingAudioPlayer | null>(null);
  const liveAvatarRef = useRef<LiveAvatarHandle | null>(null);
  const recorderRef = useRef<SessionRecorder | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const isProcessingRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const sessionSavedRef = useRef(false);
  /** Set at 4 min — causes the next onFinal to trigger __END__ after the user's sentence. */
  const pendingEndRef = useRef(false);
  const endTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Resolver for waitForPlaybackToFinish() — set while waiting for the current TTS to finish. */
  const playbackDoneWaiterRef = useRef<(() => void) | null>(null);
  /** Guards against overlapping endSession() calls (double-click, or a manual click racing the 3-min auto-close). */
  const endSessionInFlightRef = useRef(false);
  /**
   * Mirrors the latest endSession() closure, same pattern as processBufferedRef
   * below — onFinal and the 3-min timeout are created once and never
   * recreated, so calling endSession directly from them would close over
   * stale `elapsed`/`pronunciationAvg` state instead of the current render's.
   */
  const endSessionRef = useRef<() => Promise<void>>(async () => {});
  const historyRef = useRef<Msg[]>([]);
  historyRef.current = history;
  /** Queue of turns spoken while avatar was responding — processed in order after avatar finishes. */
  const bufferedTurnsRef = useRef<
    Array<{
      text: string;
      pronunciation: PronunciationResult;
      recordingPromise: Promise<{ blob: Blob } | null>;
      turnLogId: string;
    }>
  >([]);
  /** Latency-instrumentation turn counter (H-01) — each real user turn gets a short id so its
   *  client + server log lines (logs/server-YYYY-MM-DD.log) can be correlated end to end. */
  const turnCounterRef = useRef(0);
  /** Flush function stored in a ref so the amplitude callback can call it without stale closures. */
  const processBufferedRef = useRef<() => void>(() => {});
  /** Per-turn MediaRecorder — one recording per user utterance, restarted after each turn. */
  const turnRecorderRef = useRef<MediaRecorder | null>(null);
  /**
   * Dedicated mic stream for per-turn and session recording.
   * AzureSTT manages its own internal getUserMedia — this stream is for
   * MediaRecorder only, so there is no AudioContext conflict.
   */
  const micStreamRef = useRef<MediaStream | null>(null);

  // Derived: average pronunciation scores across all scored user turns
  const pronunciationAvg = useMemo<PronunciationAvg | null>(() => {
    const scored = history.filter((m) => m.role === "user" && m.pronunciation);
    if (!scored.length) return null;
    const avg = (key: keyof PronunciationResult) => {
      const vals = scored.map((m) => m.pronunciation![key] as number);
      return vals.reduce((a, b) => a + b, 0) / vals.length;
    };
    const pronunciation = avg("pronunciationScore");
    // WPM over substantive turns (≥ 6 words; short answers return wpm=0).
    // Word-WEIGHTED, not a plain mean: a 40-word turn should count far more
    // than a 6-word one toward the speaking-rate figure that anchors fluency.
    const wpmTurns = scored.filter((m) => (m.pronunciation!.wpm ?? 0) > 0);
    const wordsOf = (m: Msg) =>
      m.pronunciation!.words?.length || m.content.trim().split(/\s+/).filter(Boolean).length;
    const wpmWordTotal = wpmTurns.reduce((s, m) => s + wordsOf(m), 0);
    const wpm = wpmWordTotal > 0
      ? wpmTurns.reduce((s, m) => s + m.pronunciation!.wpm * wordsOf(m), 0) / wpmWordTotal
      : 0;
    const score = Math.round(pronunciation);
    const shortTurns = scored.filter((m) => (m.pronunciation!.wpm ?? 0) === 0).length;
    return {
      pronunciation,
      wpm,
      score,
      count: scored.length,
      shortTurns,
    };
  }, [history]);

  // ── timer ── freezes the instant phase leaves "active" (evaluation starting).
  useEffect(() => {
    if (!sessionStarted || phase !== "active") return;
    const id = setInterval(() => {
      if (startedAtRef.current)
        setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [sessionStarted, phase]);

  // Close the conversation gracefully at 3 min, then end the session.
  // Don't interrupt mid-sentence: set a flag so onFinal triggers __END__
  // after the user finishes speaking. Safety timeout fires after 20 s in
  // case the user is already silent. endSession() itself stops STT
  // synchronously, so it must only run AFTER the closing turn completes —
  // never call it directly from here.
  useEffect(() => {
    if (elapsed === 180 && phase === "active" && !pendingEndRef.current) {
      pendingEndRef.current = true;
      endTimeoutRef.current = setTimeout(() => {
        if (pendingEndRef.current) {
          pendingEndRef.current = false;
          deliverClosingRemarkAndEnd();
        }
      }, 20_000);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsed, phase]);

  // ── save session via the server API (no direct Supabase access from the browser) ──
  const saveSession = async (audioBlob: Blob | null, result?: typeof cefrResult) => {
    if (sessionSavedRef.current) return;
    sessionSavedRef.current = true;

    const form = new FormData();
    form.append("language", language);
    form.append("durationSeconds", String(elapsed));
    if (result?.level) form.append("cefrLevel", result.level);
    if (result?.score_percent != null) form.append("globalScore", String(result.score_percent));
    form.append("scores", JSON.stringify(result?.dimensions ?? null));
    form.append("evaluation", JSON.stringify(result ?? null));
    form.append("pronunciationScores", JSON.stringify(pronunciationAvg));

    if (audioBlob && audioBlob.size > 0) {
      const ext = audioBlob.type.includes("ogg") ? "ogg" : "webm";
      form.append("sessionAudio", audioBlob, `session.${ext}`);
    }

    // Per-turn audio only exists as blob: object URLs (set once pass-2
    // pronunciation assessment finishes) — re-fetch each one to recover the
    // underlying Blob for upload, since blob: URLs don't survive past this tab.
    const turns = historyRef.current;
    const turnsMeta: Array<{ role: string; content: string; pronunciation: unknown | null; hasAudio: boolean }> = [];
    for (let i = 0; i < turns.length; i++) {
      const m = turns[i];
      let hasAudio = false;
      if (m.role === "user" && m.audioUrl?.startsWith("blob:")) {
        try {
          const blob = await (await fetch(m.audioUrl)).blob();
          if (blob.size > 0) {
            // Usually the conditioned WAV from callPronunciationAPI, but falls
            // back to the raw recording (webm/mp4) when that conversion failed
            // — name it by its actual type, not a hardcoded ".wav", so a
            // provider that can't read the fallback format (e.g. Voxtral) gets
            // a clean, expected rejection instead of a confusing generic one,
            // and so the file in storage isn't mislabeled for future debugging.
            const ext = blob.type.includes("wav") ? "wav" : blob.type.includes("mp4") ? "m4a" : "webm";
            form.append(`turnAudio_${i}`, blob, `turn-${i}.${ext}`);
            hasAudio = true;
          }
        } catch (e) {
          console.warn(`[save] could not read turn ${i} audio blob:`, e);
        }
      }
      turnsMeta.push({
        role: m.role,
        content: m.content,
        pronunciation: m.role === "user" ? m.pronunciation ?? null : null,
        hasAudio,
      });
    }
    form.append("turns", JSON.stringify(turnsMeta));

    try {
      const res = await fetch("/api/sessions", { method: "POST", body: form });
      if (!res.ok) {
        console.error("Session save error:", await res.text());
        return;
      }
      const { id } = (await res.json()) as { id: string };
      setSavedSessionId(id);
    } catch (e) {
      console.error("Session save error:", e);
    }
  };

  // ── per-turn recorder helpers ──────────────────────────────────────────────
  // Each MediaRecorder owns its own chunk buffer (attached to the instance,
  // not a shared ref) — onFinal calls stopTurnRecording() immediately followed
  // by startTurnRecording() for the next turn, and MediaRecorder.stop() only
  // flushes its final chunk + fires onstop asynchronously, after that next
  // recorder has already started. A shared buffer got reset/reused by the new
  // recorder before the old one's onstop read it, silently building every
  // turn's blob out of the wrong (or no) audio.
  type TurnRecorder = MediaRecorder & { _chunks: Blob[] };

  const startTurnRecording = () => {
    if (turnRecorderRef.current) return; // already recording
    const stream = micStreamRef.current;
    if (!stream) { console.warn("startTurnRecording: mic stream not available"); return; }
    // Pick the best supported mimeType across browsers
    const mimeType =
      MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" :
      MediaRecorder.isTypeSupported("audio/webm")             ? "audio/webm" :
      MediaRecorder.isTypeSupported("audio/mp4")              ? "audio/mp4" :
      "";
    if (!mimeType) { console.warn("startTurnRecording: no supported mimeType"); return; }
    try {
      // 256 kbps opus: extra spectral headroom before the 16 kHz downsample in
      // blobToWav16kMono — costs nothing, preserves consonant detail.
      const mr = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 256_000 }) as TurnRecorder;
      mr._chunks = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) mr._chunks.push(e.data); };
      mr.onerror = (e) => console.error("TurnRecorder error:", e);
      mr.start(500); // collect chunks every 500 ms
      turnRecorderRef.current = mr;
    } catch (e) {
      console.error("startTurnRecording failed:", e);
    }
  };

  const stopTurnRecording = (): Promise<{ blob: Blob } | null> => {
    const mr = turnRecorderRef.current as TurnRecorder | null;
    turnRecorderRef.current = null;
    if (!mr || mr.state === "inactive") return Promise.resolve(null);
    return new Promise((resolve) => {
      mr.onstop = () => {
        const blob = new Blob(mr._chunks, { type: mr.mimeType });
        if (blob.size === 0) { resolve(null); return; }
        // No object URL here — the transcript player uses the conditioned WAV
        // created in callPronunciationAPI, not the raw webm.
        resolve({ blob });
      };
      mr.stop();
    });
  };

  // ── two-pass pronunciation: REST API with LLM-corrected reference ───────────
  // Pass 1: AzureSTT SDK scores (free-speech mode — lenient, near-100 for any
  //   recognized word) are attached immediately as placeholders.
  // Pass 2 (this function): converts the turn recording to WAV 16 kHz mono
  //   (Azure's REST endpoint rejects Chrome's webm container — the silent
  //   failure that left pass-1's ~100 scores on screen), then sends it with the
  //   transcript + examiner question. The server has Claude reconstruct the
  //   INTENDED text and Azure scores actual phonemes against it
  //   (EnableMiscue:true) — catching substitutions, omissions, insertions.
  //   Result overwrites the pass-1 scores in place.
  const callPronunciationAPI = async (
    blob: Blob,
    turnIndex: number,
    wpm: number,
    referenceText: string,
    context: string,
  ) => {
    let audio = blob;
    let filename = "turn.webm";
    try {
      audio = await blobToWav16kMono(blob);
      filename = "turn.wav";
    } catch (firstError) {
      // A single decode can fail transiently (e.g. a timing race on the
      // shared AudioContext — see lib/audio-wav.ts) — retry once before
      // falling back to the raw recording, which strict-format providers
      // (e.g. Voxtral, wav/mp3 only) can't process at all.
      try {
        audio = await blobToWav16kMono(blob);
        filename = "turn.wav";
      } catch (secondError) {
        console.warn("[pronunciation] WAV conversion failed twice, sending raw blob:", secondError);
        // This failure was previously only ever visible in the browser
        // console — send it server-side so it's diagnosable from
        // logs/server-*.log without needing a live repro.
        logClientEvent("wav_conversion_failed", {
          turnIndex,
          blobType: blob.type,
          blobSize: blob.size,
          firstError: String(firstError instanceof Error ? firstError.message : firstError),
          secondError: String(secondError instanceof Error ? secondError.message : secondError),
        });
      }
    }

    // The transcript's per-turn player gets the CONDITIONED WAV, not the raw
    // webm: the raw track is recorded with AGC off and can be inaudibly quiet,
    // while the WAV is silence-trimmed and peak-normalised — and it is exactly
    // the audio the assessment engines heard, so listening back lets you check
    // the judge's verdicts against the same evidence.
    const playbackUrl = URL.createObjectURL(audio);
    setHistory((h) =>
      h.map((m, i) => (i === turnIndex && m.role === "user" ? { ...m, audioUrl: playbackUrl } : m))
    );

    const form = new FormData();
    form.append("audio", audio, filename);
    form.append("language", language);
    form.append("wpm", String(wpm));
    form.append("referenceText", referenceText);
    // The examiner's question this turn answers — used server-side by the LLM
    // correction step to reconstruct what the learner intended to say.
    form.append("context", context);

    try {
      const r = await fetch("/api/pronunciation", { method: "POST", body: form });
      if (!r.ok) {
        // Loud failure: a dead pass 2 means the lenient pass-1 scores stay on
        // screen — exactly the "everything is 100%" bug. Never fail silently.
        console.error(`[pronunciation] pass-2 HTTP ${r.status}: ${await r.text()}`);
        return;
      }
      const result = (await r.json()) as PronunciationResult | null;
      if (!result) {
        console.warn("[pronunciation] pass-2 returned no result (Azure no-speech)");
        return;
      }
      console.log(`[pronunciation] pass-2 OK turn=${turnIndex} score=${result.pronunciationScore} source=${result.source}`);
      setHistory((h) =>
        h.map((m, i) => {
          if (i !== turnIndex || m.role !== "user" || !m.pronunciation) return m;
          return { ...m, pronunciation: result };
        })
      );
    } catch (e) {
      console.error("[pronunciation] pass-2 request failed:", e);
    }
  };

  // ── session ──
  const startSession = async () => {
    setSessionStarted(true);
    sessionSavedRef.current = false;
    startedAtRef.current = Date.now();

    // Reset ALL per-session state from any previous run. Without this, a stale
    // cefrResult from the last evaluation keeps the pronunciation panel and
    // coloured transcript words visible during the entire new session (every
    // `cefrResult &&` display gate passes from the first second).
    setCefrResult(null);
    setPhase("active");
    setEvalDone(false);
    setEvalFailed(false);
    endSessionInFlightRef.current = false;
    setHistory([]);
    // historyRef is normally synced on render — but handleUserTurn("__START__")
    // below runs before the next render, so clear the ref directly or the new
    // session's first /api/chat call would include the previous transcript.
    historyRef.current = [];
    setPartialUser("");
    setStreamingAssistant("");
    setElapsed(0);
    setChatError(null);
    setIsThinking(false);
    bufferedTurnsRef.current = [];
    if (audioBlobUrlRef.current) {
      URL.revokeObjectURL(audioBlobUrlRef.current);
      audioBlobUrlRef.current = null;
    }
    setAudioBlob(null);

    if (!USE_HEYGEN) {
      // Create player and unlock AudioContext NOW — must be synchronous and
      // inside the click handler before any await, otherwise Chrome's autoplay
      // policy will block the AudioContext when the first TTS chunk arrives.
      // The MediaStreamDestinationNode (for session recording) is also created
      // here so it's ready when we connect the mic stream after Deepgram starts.
      playerRef.current = new StreamingAudioPlayer((amp) => {
        const wasSpeaking = isSpeakingRef.current;
        isSpeakingRef.current = amp > 0;
        setAmplitude(amp);
        // When the last audio chunk finishes playing, flush any queued user turns.
        // This is the correct moment — the SSE stream ends before audio finishes,
        // so flushing from the SSE callback would overlap with playback.
        if (wasSpeaking && amp === 0) {
          processBufferedRef.current();
          playbackDoneWaiterRef.current?.();
          playbackDoneWaiterRef.current = null;
        }
      });
      playerRef.current.init();
    }

    // ── Azure STT: transcription + pronunciation in one step ─────────────────
    sttRef.current = new AzureSTT(language, {
      onPartial: (text) => {
        if (isSpeakingRef.current) return;
        setPartialUser(text);
        if (USE_HEYGEN) liveAvatarRef.current?.startListening();
      },
      onFinal: async (text, azurePron) => {
        if (!text.trim()) return;

        // Azure SDK returns per-phoneme scores directly — no secondary REST call needed.
        const pronunciation: PronunciationResult = { ...azurePron, source: "azure" };

        // H-01 latency instrumentation: mark the moment STT considers the
        // utterance final, tagged with whether it's about to sit in the
        // buffer (avatar still busy) — that wait is turn-taking, not pipeline
        // latency, so keeping it visible lets the two be told apart later.
        const turnLogId = `turn-${++turnCounterRef.current}`;
        const willBuffer = isProcessingRef.current || isSpeakingRef.current;
        logClientEvent("turn_stt_final", { turnLogId, buffered: willBuffer });

        // Always close out THIS utterance's recording the instant STT
        // recognizes it, regardless of whether the avatar is busy — the
        // recorder must be scoped to when the user actually spoke, not to
        // whenever a buffered turn eventually gets flushed. Deferring the
        // stop/start to flush time (the old behaviour) made the recorded
        // window the gap between two flushes — often under a second — instead
        // of the real utterance, producing near-empty recordings for any
        // turn that got buffered.
        const recordingPromise = stopTurnRecording();
        startTurnRecording();

        // Avatar is still talking or processing a previous turn — queue this
        // turn (its audio is already correctly captured above). All queued
        // turns are replayed in order once the avatar finishes speaking.
        if (willBuffer) {
          bufferedTurnsRef.current.push({ text, pronunciation, recordingPromise, turnLogId });
          return;
        }

        setPartialUser("");
        if (USE_HEYGEN) liveAvatarRef.current?.stopListening();

        const turnIndex = historyRef.current.length;

        // Capture and clear the pending-end flag before any await.
        const shouldEnd = pendingEndRef.current;
        if (shouldEnd) {
          pendingEndRef.current = false;
          if (endTimeoutRef.current) {
            clearTimeout(endTimeoutRef.current);
            endTimeoutRef.current = null;
          }
        }

        // The examiner's question this turn answers — captured BEFORE
        // the avatar's next reply is appended to history.
        const questionContext =
          [...historyRef.current].reverse().find((m) => m.role === "assistant")?.content ?? "";

        if (shouldEnd) {
          // Winding down: record + assess this final answer, but do NOT let the
          // avatar ask another question right before closing (that made the
          // ending feel abrupt). Append the user turn to history directly, then
          // go straight to the closing comment, which Claude phrases naturally
          // around the answer it can now see in the transcript.
          const finalHistory: Msg[] = [
            ...historyRef.current,
            { role: "user", content: text, pronunciation },
          ];
          historyRef.current = finalHistory;
          setHistory(finalHistory);
        } else {
          await handleUserTurn(text, pronunciation, turnLogId);
        }

        // Kick off the assessment in the background. callPronunciationAPI also
        // attaches the conditioned WAV to the transcript player (the raw webm
        // is recorded with AGC off and can be inaudibly quiet). This runs
        // concurrently with the next turn's /api/chat call — both are Mistral
        // calls, but lib/mistral-queue.ts already caps concurrent Mistral
        // requests server-side (MISTRAL_MAX_CONCURRENCY, default 2), so this
        // no longer needs to be serialized here at the page level.
        void recordingPromise.then((recording) => {
          if (!recording) return;
          return callPronunciationAPI(recording.blob, turnIndex, azurePron.wpm, text, questionContext);
        });

        if (shouldEnd) {
          await deliverClosingRemarkAndEnd();
        }
      },
      onError: (e) => console.error("Azure STT error:", e),
    });

    // Open a dedicated mic stream for per-turn recording AND session listen-back.
    // AzureSTT manages its own internal getUserMedia — this stream is used only by
    // MediaRecorder and the player's AudioContext (for mixing), so there is no
    // dual-AudioContext conflict of any kind.
    try {
      // Fidelity-first constraints for the ASSESSMENT stream:
      // - noiseSuppression OFF: browser noise suppression is telephony-grade
      //   and strips broadband fricative energy (/s/ /θ/ /f/ /ʃ/) — exactly
      //   the phonemes pronunciation assessment needs intact.
      // - autoGainControl OFF: AGC pumping distorts phoneme energy; levels are
      //   normalised later in blobToWav16kMono instead.
      // - echoCancellation stays ON: it keeps the avatar's question (playing
      //   through the speakers while the turn recorder runs) out of the clip.
      // Safe because this stream is SEPARATE from AzureSTT's internal mic
      // stream — the live recognizer keeps its own DSP-processed signal, so
      // VAD/segmentation behaviour is unaffected.
      micStreamRef.current = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: false,
          echoCancellation: true,
          noiseSuppression: false,
          channelCount: 1,
          sampleRate: 48000,
        },
        video: false,
      });
      // Mix the mic into the player's session-recording destination so the
      // listen-back audio captures both sides (avatar TTS + user voice).
      // Safe now that AzureSTT owns a completely separate internal stream.
      if (!USE_HEYGEN && playerRef.current) {
        playerRef.current.addMicStream(micStreamRef.current);
      }
    } catch (e) {
      console.warn("Mic stream for recording unavailable:", e);
    }

    // Start Azure STT — failure is non-fatal (avatar TTS still works).
    try {
      await sttRef.current.start();
      startTurnRecording(); // begin recording the first user turn

      if (!USE_HEYGEN && playerRef.current) {
        // Session recording: TTS + mic audio mixed via the player's recordingDest.
        const ttsStream = playerRef.current.getRecordingStream();
        recorderRef.current = new SessionRecorder(ttsStream ?? (micStreamRef.current ?? undefined));
      } else {
        recorderRef.current = new SessionRecorder(micStreamRef.current ?? undefined);
      }
    } catch (e) {
      console.error("Azure STT failed to start:", e);
      recorderRef.current = new SessionRecorder(micStreamRef.current ?? undefined);
    }
    recorderRef.current.start();

    // Kick off the conversation regardless of STT status
    await handleUserTurn("__START__");
  };

  const handleUserTurn = async (userText: string, pronunciation?: PronunciationResult, turnLogId?: string) => {
    isProcessingRef.current = true;
    setIsThinking(true);
    setChatError(null);
    const isStart = userText === "__START__";
    const isEnd   = userText === "__END__";
    // H-01 latency instrumentation id — falls back to a synthetic one for the
    // opening/closing turns, which don't come from onFinal.
    const logId = turnLogId ?? (isStart ? "start" : isEnd ? "end" : "unknown");

    try {
      // This turn's /api/chat call is allowed to overlap the previous turn's
      // pronunciation-judge Mistral call (previously serialized here to avoid
      // rate-limit bursts) — lib/mistral-queue.ts caps concurrent Mistral
      // requests server-side, so the two calls now queue safely there instead
      // of blocking the examiner's next reply on the previous answer's score.
      const newHistory: Msg[] = (isStart || isEnd)
        ? historyRef.current
        : [...historyRef.current, { role: "user", content: userText, pronunciation }];

      if (!isStart && !isEnd) setHistory(newHistory);
      setStreamingAssistant("");

      const userMessage = isStart
        ? language === "fr"
          ? "Bonjour, démarrons la conversation."
          : "Hello, let's start the conversation."
        : isEnd
          ? "__END__"
          : userText;

      // H-01: marks when the request actually goes out — the gap since
      // turn_stt_final includes any buffering wait (avatar still speaking),
      // so the two are logged separately rather than folded into one number.
      logClientEvent("turn_chat_request_sent", { turnLogId: logId });
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language, history: newHistory, userMessage, turnLogId: logId }),
      });

      if (!res.body) {
        isProcessingRef.current = false;
        setIsThinking(false);
        setChatError("L'examinateur rencontre un problème technique, réessaie dans un instant.");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let assistantText = "";
      // H-01: log only the FIRST text/audio event per turn — deltas/chunks
      // arrive in bursts and aren't individually interesting for latency.
      let loggedFirstText = false;
      let loggedFirstAudio = false;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const evt of events) {
          const evtMatch = evt.match(/^event: (\w+)/m);
          const dataMatch = evt.match(/^data: (.+)$/m);
          if (!evtMatch || !dataMatch) continue;

          const type = evtMatch[1];
          const data = dataMatch[1];

          if (type === "text") {
            if (!loggedFirstText) {
              loggedFirstText = true;
              logClientEvent("turn_first_text", { turnLogId: logId });
            }
            const { delta } = JSON.parse(data);
            assistantText += delta;
            setStreamingAssistant(assistantText);
            setIsThinking(false);
          } else if (type === "audio") {
            if (!loggedFirstAudio) {
              loggedFirstAudio = true;
              logClientEvent("turn_first_audio", { turnLogId: logId });
            }
            if (USE_HEYGEN) {
              liveAvatarRef.current?.sendAudio(data);
            } else {
              playerRef.current?.playChunk(data);
            }
          } else if (type === "done") {
            logClientEvent("turn_stream_done", { turnLogId: logId });
            const { fullText } = JSON.parse(data);
            // Defense in depth: an empty-content assistant message stuck in
            // history gets sent back to Mistral on every future turn, which
            // rejects it outright — never let one in, regardless of what the
            // server sends.
            if (fullText.trim()) {
              setHistory((h) => [...h, { role: "assistant", content: fullText }]);
            }
            setStreamingAssistant("");
            setIsThinking(false);
            if (USE_HEYGEN) liveAvatarRef.current?.speakEnd();
          } else if (type === "error") {
            console.error("Stream error:", data);
            setIsThinking(false);
            setChatError("L'examinateur rencontre un problème technique, réessaie dans un instant.");
          }
        }
      }

      if (!isEnd) {
        isProcessingRef.current = false;
        // Flush buffered turns only if audio has already finished playing.
        // If avatar is still speaking (SSE ended before last chunk played out),
        // the StreamingAudioPlayer amplitude→0 callback will trigger the flush
        // at the correct moment instead.
        processBufferedRef.current();
      }
    } catch (err) {
      // Any network error or malformed JSON in the SSE stream would otherwise
      // leave isProcessingRef permanently true — every subsequent user turn
      // buffers and nothing ever flushes, making the system appear deaf.
      console.error("handleUserTurn failed:", err);
      isProcessingRef.current = false;
      setIsThinking(false);
      setChatError("L'examinateur rencontre un problème technique, réessaie dans un instant.");
      processBufferedRef.current();
    }
  };

  // ── flush function: process the next queued user turn ─────────────────────
  // Stored in a ref so the amplitude callback (which runs outside React's
  // render cycle) always calls the latest version via processBufferedRef.current.
  processBufferedRef.current = async () => {
    if (isProcessingRef.current || isSpeakingRef.current) return;
    const buffered = bufferedTurnsRef.current.shift();
    if (!buffered) return;
    const turnIndex = historyRef.current.length;
    // This turn's audio was already correctly captured live, in onFinal, at
    // the moment STT recognized it — the recorder is NOT touched here, which
    // would only span the (near-instant) gap between flushes instead of the
    // actual utterance.
    // Examiner's question — captured before handleUserTurn appends the reply.
    const questionContext =
      [...historyRef.current].reverse().find((m) => m.role === "assistant")?.content ?? "";
    await handleUserTurn(buffered.text, buffered.pronunciation, buffered.turnLogId);
    void buffered.recordingPromise.then((recording) => {
      if (!recording) return;
      return callPronunciationAPI(recording.blob, turnIndex, buffered.pronunciation.wpm ?? 0, buffered.text, questionContext);
    });
  };

  // ── end the session: stop everything, show the full-screen evaluating
  // takeover immediately, then evaluate and ALWAYS persist — this is now the
  // one and only way a session ends, so a failed evaluation must never
  // strand the user without a saved session.
  // TODO: under USE_HEYGEN, this never tears down the HeyGen-side avatar
  // session (liveAvatarRef) — pre-existing gap, not addressed here.
  const endSession = async () => {
    if (endSessionInFlightRef.current) return;
    endSessionInFlightRef.current = true;

    pendingEndRef.current = false;
    if (endTimeoutRef.current) {
      clearTimeout(endTimeoutRef.current);
      endTimeoutRef.current = null;
    }

    setPhase("evaluating"); // flip the UI before any awaits

    await stopTurnRecording();
    sttRef.current?.stop();
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    // Stop session recorder BEFORE closing the player's AudioContext — the
    // combined stream is sourced from the player's MediaStreamDestinationNode,
    // so closing the AudioContext first would cut the stream before the
    // recorder can flush its final buffered chunk.
    const blob = await recorderRef.current?.stop() ?? null;
    if (!USE_HEYGEN) playerRef.current?.stop();
    if (blob && blob.size > 0) {
      if (audioBlobUrlRef.current) URL.revokeObjectURL(audioBlobUrlRef.current);
      audioBlobUrlRef.current = URL.createObjectURL(blob);
      setAudioBlob(blob);
    }

    let result: CefrResult | null = null;
    try {
      const userTurns = historyRef.current
        .filter((m) => m.role === "user")
        .map((m) => m.content);

      const res = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language, userTurns, pronunciationContext: pronunciationAvg }),
      });
      if (!res.ok) throw new Error(`evaluate HTTP ${res.status}`);
      result = await res.json();
    } catch (e) {
      console.error("Evaluation failed:", e);
      setEvalFailed(true);
    }
    setCefrResult(result);

    // Persist regardless of whether evaluation succeeded — this is the only
    // place a session is ever saved, so it must always run.
    await saveSession(blob ?? audioBlob, result ?? undefined);

    setEvalDone(true); // EvaluatingScreen takes it from here (min-visible-duration, then phase -> "done")
  };
  endSessionRef.current = endSession;

  /**
   * Resolves once the avatar's current TTS has actually finished playing (or
   * immediately, if it already has) — capped by a safety timeout so a missed
   * amplitude event (e.g. no audio was ever scheduled) can never hang the
   * ending flow indefinitely.
   */
  const waitForPlaybackToFinish = (timeoutMs = 8000): Promise<void> => {
    if (!isSpeakingRef.current) return Promise.resolve();
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        playbackDoneWaiterRef.current = null;
        resolve();
      };
      playbackDoneWaiterRef.current = finish;
      setTimeout(finish, timeoutMs);
    });
  };

  /** Speak the closing remark, let it fully play out, THEN end the session. */
  const deliverClosingRemarkAndEnd = async () => {
    await handleUserTurn("__END__");
    await waitForPlaybackToFinish();
    await endSessionRef.current();
  };

  const mm = Math.floor(elapsed / 60).toString().padStart(2, "0");
  const ss = (elapsed % 60).toString().padStart(2, "0");

  // Shared between the "active" sidebar and the full-width "done" panel —
  // identical markup either way; `cefrResult` (null during "active") is what
  // gates the pronunciation colouring/badges/audio on.
  const transcriptPanel = (
    <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px" }}>
      <div style={{ fontSize: 11, color: "#475569", fontWeight: 700, letterSpacing: 1, marginBottom: 10 }}>
        TRANSCRIPT
      </div>
      {history.length === 0 && (
        <p style={{ color: "#334155", fontSize: 13 }}>La conversation s&apos;affichera ici…</p>
      )}
      {history.map((m, i) => (
        <div
          key={i}
          style={{
            marginBottom: 10,
            padding: "8px 10px",
            background: m.role === "user" ? "#1e293b" : "#1e1b4b",
            borderRadius: 6,
            borderLeft: `3px solid ${m.role === "user" ? "#334155" : "#4f46e5"}`,
          }}
        >
          <div style={{ fontSize: 10, color: "#64748b", marginBottom: 4 }}>
            {m.role === "user" ? "Vous" : "Avatar"}
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.5 }}>
            {/* Coloured pronunciation words appear only after the CEFR
                evaluation — during the session the transcript stays plain. */}
            {cefrResult && m.role === "user" && m.pronunciation?.words?.length ? (
              <UserWords words={m.pronunciation.words} />
            ) : (
              m.content
            )}
          </div>
          {cefrResult && m.role === "user" && m.pronunciation && (
            <UtteranceBadges p={m.pronunciation} />
          )}
          {m.role === "user" && m.audioUrl && cefrResult && (
            <audio
              controls
              src={m.audioUrl}
              onError={(e) => {
                // A bad blob source would otherwise render a broken
                // player; hide it and log instead of surfacing an error.
                console.warn(`[playback] turn ${i} audio failed to load`);
                (e.currentTarget as HTMLAudioElement).style.display = "none";
              }}
              style={{ width: "100%", height: 28, marginTop: 6, accentColor: "#4f46e5", display: "block" }}
            />
          )}
        </div>
      ))}
    </div>
  );

  return (
    <main style={{ display: "flex", height: "100vh", flexDirection: "column", background: "#0f172a", color: "#f1f5f9" }}>
      {/* ── header ── */}
      <header
        style={{
          padding: "10px 20px",
          borderBottom: "1px solid #1e293b",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexShrink: 0,
        }}
      >
        <h1 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>ELAO Speaking POC</h1>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <AuthNavLink />
          {sessionStarted && (
            <span style={{ fontFamily: "monospace", fontSize: 13, color: elapsed >= 180 ? "#4ade80" : "#94a3b8" }}>
              {mm}:{ss} {elapsed >= 180 ? "✓" : ""}
            </span>
          )}
          {sessionStarted && phase === "active" && (
            <button onClick={endSession} style={btn("#10b981")}>
              Terminer et évaluer
            </button>
          )}
          {sessionStarted && phase === "done" && (
            <button onClick={() => setSessionStarted(false)} style={btn("#4f46e5")}>
              Nouvelle session
            </button>
          )}
        </div>
      </header>

      {/* ── pre-session: language picker + Start ── */}
      {!sessionStarted && (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, overflow: "auto" }}>
          <div style={{ width: "100%", maxWidth: 560, textAlign: "center" }}>
            <div style={{ fontSize: 48, marginBottom: 8 }}>🎙️</div>
            <h2 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 600 }}>Choisis ta langue</h2>
            <p style={{ margin: "0 0 28px", color: "#94a3b8", fontSize: 14 }}>
              Sélectionne la langue de l&apos;évaluation orale, puis démarre la session.
            </p>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 10,
                marginBottom: 32,
              }}
            >
              {LANGUAGES.map((l) => (
                <button
                  key={l.code}
                  onClick={() => setLanguage(l.code)}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 6,
                    padding: "16px 10px",
                    borderRadius: 10,
                    cursor: "pointer",
                    background: language === l.code ? "#312e81" : "#1e293b",
                    border: `2px solid ${language === l.code ? "#6366f1" : "#334155"}`,
                    color: "#f1f5f9",
                    transition: "background 0.15s, border-color 0.15s",
                  }}
                >
                  <span style={{ fontSize: 28 }}>{l.flag}</span>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{l.label}</span>
                </button>
              ))}
            </div>
            <button
              onClick={startSession}
              style={{
                padding: "14px 48px",
                background: "#4f46e5",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                cursor: "pointer",
                fontSize: 16,
                fontWeight: 600,
                letterSpacing: 0.3,
                boxShadow: "0 4px 14px rgba(79, 70, 229, 0.4)",
              }}
            >
              ▶ Démarrer
            </button>
          </div>
        </div>
      )}

      {/* ── body ──
          "active": avatar left + transcript sidebar right.
          "evaluating": full-screen takeover, no avatar/sidebar.
          "done": avatar is gone, the analysis (panels, listen-back audio,
          transcript) goes full screen. */}
      {sessionStarted && phase === "active" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 520px", flex: 1, overflow: "hidden" }}>
          <div style={{ position: "relative", overflow: "hidden" }}>
            {USE_HEYGEN ? (
              <LiveAvatar ref={liveAvatarRef} onAmplitude={(amp) => setAmplitude(amp)} />
            ) : (
              <Avatar amplitude={amplitude} />
            )}
            {/* Overlay: "thinking" cue while waiting on the avatar's reply —
                the gap between end-of-speech and the first streamed token
                previously had zero visual feedback. */}
            {isThinking && (
              <div style={{ position: "absolute", top: 16, right: 16 }}>
                <ThinkingIndicator variant="badge" label="…" />
              </div>
            )}
            {/* Overlay: live captions */}
            {(partialUser || streamingAssistant || chatError) && (
              <div
                style={{
                  position: "absolute",
                  bottom: 16,
                  left: 16,
                  right: 16,
                  padding: "10px 14px",
                  background: "rgba(0,0,0,0.72)",
                  borderRadius: 8,
                  backdropFilter: "blur(4px)",
                }}
              >
                {partialUser && (
                  <div style={{ fontStyle: "italic", color: "#94a3b8", fontSize: 14 }}>
                    🎤 {partialUser}
                  </div>
                )}
                {streamingAssistant && (
                  <div style={{ color: "#e2e8f0", fontSize: 14 }}>{streamingAssistant}</div>
                )}
                {chatError && !streamingAssistant && (
                  <div style={{ color: "#f87171", fontSize: 14 }}>{chatError}</div>
                )}
              </div>
            )}
          </div>

          <aside style={{ borderLeft: "1px solid #1e293b", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {transcriptPanel}
          </aside>
        </div>
      )}

      {sessionStarted && phase === "evaluating" && (
        <EvaluatingScreen done={evalDone} onDone={() => setPhase("done")} />
      )}

      {sessionStarted && phase === "done" && (
        <SessionResultsScreen
          cefrResult={cefrResult}
          pronunciationAvg={pronunciationAvg}
          evalFailed={evalFailed}
          audioBlobUrl={audioBlob ? audioBlobUrlRef.current : null}
          transcriptPanel={transcriptPanel}
          sessionId={savedSessionId}
        />
      )}
    </main>
  );
}

function btn(color: string): React.CSSProperties {
  return {
    padding: "6px 14px",
    background: color,
    color: "#fff",
    border: "none",
    borderRadius: 4,
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 500,
  };
}
