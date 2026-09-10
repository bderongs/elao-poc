"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { TurnVad } from "@/lib/turn-vad";
import type { PronunciationResult, WordScore } from "@/lib/pronunciation/types";
import { StreamingAudioPlayer } from "@/lib/audio-player";
import { SessionRecorder } from "@/lib/session-recorder";
import { blobToWav16kMono } from "@/lib/audio-wav";
import { logClientEvent } from "@/lib/client-log";
import { isCefrRung, type CefrRung } from "@/lib/cefr-rung";
import { isTopicDomain, type TopicDomain } from "@/lib/topic-domain";
import { chatProcessLabel, assessProcessLabel } from "@/lib/turn-labels";
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

const TalkingHeadAvatar = dynamic(
  () => import("@/components/TalkingHeadAvatar").then((m) => m.TalkingHeadAvatar),
  { ssr: false }
);

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
  const [avatarAnalyser, setAvatarAnalyser] = useState<AnalyserNode | null>(null);
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

  const vadRef = useRef<TurnVad | null>(null);
  const playerRef = useRef<StreamingAudioPlayer | null>(null);
  /** setTimeout ids for the in-progress caption word-reveal — cleared whenever a
   *  turn starts fresh or the session ends, so a stale reveal never bleeds text
   *  from a finished/aborted turn into the next one. */
  const revealTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const recorderRef = useRef<SessionRecorder | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const isProcessingRef = useRef(false);
  const isSpeakingRef = useRef(false);
  /** Aborts the in-flight /api/chat SSE stream — set at the start of handleUserTurn,
   *  used by handleBargeIn to stop the server generating more of a reply the user
   *  already started talking over. */
  const chatAbortControllerRef = useRef<AbortController | null>(null);
  const sessionSavedRef = useRef(false);
  /**
   * Difficulty rung to target the NEXT examiner question — set by ET's most
   * recently COMPLETED result (lib/level-assessment.ts), best-effort. A never
   * waits for ET to finish; it just reads whatever this holds when it fires.
   * "A2" matches the old inline prompt's default starting point (turn 1 is
   * always the A1 warm-up, handled separately — see startSession/handleUserTurn).
   */
  const currentRungRef = useRef<CefrRung>("A2");
  /** Bank question strings already offered this session (any rung) — Track
   *  I-03 within-session repeat-avoidance. Round-tripped with /api/chat the
   *  same way currentRungRef's rung is, but fully independent of it: this
   *  only ever talks to /api/chat, never /api/assess-transcript. */
  const usedQuestionsRef = useRef<string[]>([]);
  /**
   * TT (lib/topic-tracking.ts) tracking state — the domain of the examiner's
   * most recently asked question, and how many turns in a row have landed on
   * it. Once the streak hits the cap, handleUserTurn sends currentDomainRef's
   * value as `avoidDomain` so the server can tell the model explicitly to
   * move on, instead of relying on the model to have counted correctly
   * itself (see lib/topic-domain.ts's header comment for why).
   */
  const currentDomainRef = useRef<TopicDomain | null>(null);
  const domainStreakRef = useRef(0);
  /** Consecutive same-domain turns allowed before a switch is forced next turn. */
  const MAX_DOMAIN_STREAK = 2;
  /**
   * Admin-configurable starting rung + ET step size (lib/conversation-settings-service.ts).
   * Seeded with today's pre-existing hardcoded values, then overwritten once
   * the GET fired near the top of startSession() resolves — fire-and-forget,
   * never awaited, since currentRungRef's starting value and stepSize are
   * both only actually consumed after the user has answered the fixed-A1
   * turn 1, which takes far longer than this fetch.
   */
  const conversationSettingsRef = useRef<{ startingRung: CefrRung; stepSize: number }>({
    startingRung: "A2",
    stepSize: 1,
  });
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
   * Dedicated mic stream for per-turn recording, session recording, AND
   * turn-boundary VAD (lib/turn-vad.ts taps this same stream — no separate
   * getUserMedia call needed now that STT isn't a live SDK with its own
   * internal stream).
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

  // ── two-pass pronunciation: neutral placeholder, then the real Voxtral score ──
  // Pass 1: a neutral placeholder (score 0, no words) is attached immediately
  //   once the transcript resolves (onSpeechEnd, below) — there's no live SDK
  //   score to show in the meantime now that STT is a Voxtral batch call.
  // Pass 2 (this function): converts the turn recording to WAV 16 kHz mono
  //   and sends it to app/api/pronunciation (getProvider("voxtral")), which
  //   both re-transcribes and judges pronunciation from the audio directly.
  //   Result overwrites the pass-1 placeholder in place.
  const callPronunciationAPI = async (
    blob: Blob,
    turnIndex: number,
    wpm: number,
    referenceText: string,
    context: string,
    turnLogId: string,
  ) => {
    const eoProcess = assessProcessLabel("EO", turnLogId);
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
    form.append("turnLogId", turnLogId);

    logClientEvent("eo_request_sent", { turnLogId, process: eoProcess });
    try {
      const r = await fetch("/api/pronunciation", { method: "POST", body: form });
      if (!r.ok) {
        // Loud failure: a dead pass 2 means the lenient pass-1 scores stay on
        // screen — exactly the "everything is 100%" bug. Never fail silently.
        console.error(`[pronunciation] pass-2 HTTP ${r.status}: ${await r.text()}`);
        logClientEvent("eo_failed", { turnLogId, process: eoProcess, status: r.status });
        return;
      }
      const result = (await r.json()) as PronunciationResult | null;
      if (!result) {
        console.warn("[pronunciation] pass-2 returned no result (Azure no-speech)");
        logClientEvent("eo_failed", { turnLogId, process: eoProcess, reason: "no-speech" });
        return;
      }
      console.log(`[pronunciation] pass-2 OK turn=${turnIndex} score=${result.pronunciationScore} source=${result.source}`);
      logClientEvent("eo_result_received", { turnLogId, process: eoProcess, score: result.pronunciationScore });
      setHistory((h) =>
        h.map((m, i) => {
          if (i !== turnIndex || m.role !== "user" || !m.pronunciation) return m;
          return { ...m, pronunciation: result };
        })
      );
    } catch (e) {
      console.error("[pronunciation] pass-2 request failed:", e);
      logClientEvent("eo_failed", { turnLogId, process: eoProcess, error: String(e) });
    }
  };

  /**
   * ET — Evaluation Transcription. Fired immediately when STT finalizes a
   * user answer (text-only, doesn't need the recording — see onFinal below),
   * non-blocking: nothing ever awaits this. It just updates currentRungRef
   * when it completes, best-effort — the next /api/chat call reads whatever
   * currentRungRef holds at the moment it fires, stale or not.
   */
  const runTranscriptAssessment = async (userAnswer: string, questionAsked: string, turnLogId: string) => {
    const etProcess = assessProcessLabel("ET", turnLogId);
    logClientEvent("et_request_sent", { turnLogId, process: etProcess });
    try {
      const r = await fetch("/api/assess-transcript", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          language,
          questionAsked,
          userAnswer,
          currentRung: currentRungRef.current,
          turnLogId,
          stepSize: conversationSettingsRef.current.stepSize,
        }),
      });
      if (!r.ok) {
        logClientEvent("et_failed", { turnLogId, process: etProcess, status: r.status });
        return;
      }
      const { nextRung, verdict } = (await r.json()) as { nextRung: string; verdict: string };
      logClientEvent("et_result_received", {
        turnLogId,
        process: etProcess,
        previousRung: currentRungRef.current,
        nextRung,
        verdict,
      });
      if (isCefrRung(nextRung)) currentRungRef.current = nextRung;
    } catch (e) {
      logClientEvent("et_failed", { turnLogId, process: etProcess, error: String(e) });
    }
  };

  /**
   * TT — Topic Tracking. Fired right after an examiner reply's full text is
   * known (the "done" SSE event in handleUserTurn below), non-blocking: tags
   * which life domain that question belongs to and updates the same-domain
   * streak. handleUserTurn reads currentDomainRef/domainStreakRef when
   * building the NEXT /api/chat request, best-effort — same tolerance as ET.
   */
  const runTopicClassification = async (questionAsked: string, recentExchange: string, turnLogId: string) => {
    const ttProcess = assessProcessLabel("TT", turnLogId);
    try {
      const r = await fetch("/api/classify-topic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionAsked, recentExchange, turnLogId }),
      });
      if (!r.ok) return;
      const { domain } = (await r.json()) as { domain: string | null };
      if (!isTopicDomain(domain)) return;
      domainStreakRef.current = domain === currentDomainRef.current ? domainStreakRef.current + 1 : 1;
      currentDomainRef.current = domain;
      logClientEvent("tt_result_received", { turnLogId, process: ttProcess, domain, streak: domainStreakRef.current });
    } catch (e) {
      logClientEvent("tt_failed", { turnLogId, process: ttProcess, error: String(e) });
    }
  };

  /** Cancels any in-progress caption word-reveal timers (see scheduleWordReveal). */
  function clearPendingReveals() {
    revealTimeoutsRef.current.forEach((id) => clearTimeout(id));
    revealTimeoutsRef.current = [];
  }

  /**
   * Reveals `text` word by word over `durationMs` — passed to StreamingAudioPlayer
   * as onSentenceStart, so it fires at the moment this sentence's audio actually
   * starts playing, not when the SSE "text" event streamed in. The raw LLM token
   * stream typically finishes generating the WHOLE reply well before TTS/playback
   * even starts on the first sentence, so driving the caption off it directly
   * showed the answer on screen long before any of it was audible.
   * Word timing is an estimate, not real boundaries: each word's share of
   * durationMs is proportional to its character length. Neither TTS provider
   * used here (Azure REST, Mistral/Voxtral) returns word-level timestamps —
   * only a whole-sentence PCM buffer — so this is the closest approximation of
   * "appears as it's spoken" available without a bigger TTS integration change.
   */
  function scheduleWordReveal(text: string, durationMs: number) {
    const tokens = text.split(/(\s+)/).filter((t) => t.length > 0);
    const totalChars = tokens.reduce((sum, t) => sum + (/^\s+$/.test(t) ? 0 : t.length), 0) || 1;
    let elapsed = 0;
    let isFirst = true;
    for (const token of tokens) {
      const id = setTimeout(() => {
        setStreamingAssistant((prev) => prev + token);
        if (isFirst) {
          isFirst = false;
          setIsThinking(false);
        }
      }, elapsed);
      revealTimeoutsRef.current.push(id);
      if (!/^\s+$/.test(token)) elapsed += (token.length / totalChars) * durationMs;
    }
  }

  // ── session ──
  const startSession = async () => {
    setSessionStarted(true);
    sessionSavedRef.current = false;
    startedAtRef.current = Date.now();

    // Fire-and-forget: resolve this language's admin-configured starting rung
    // + ET step size (lib/conversation-settings-service.ts). Not awaited —
    // the mic-permission prompt and STT connect below already take real time,
    // and currentRungRef's starting value/stepSize are only actually
    // consumed after the user answers the fixed-A1 turn 1, so there's ample
    // time for this to resolve. Falls back to conversationSettingsRef's
    // seeded default if the fetch fails or hasn't resolved in time.
    fetch(`/api/conversation-settings?language=${language}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((settings) => {
        if (settings && isCefrRung(settings.startingRung) && Number.isInteger(settings.stepSize)) {
          conversationSettingsRef.current = settings;
          // currentRungRef.current is set synchronously from the (still-default)
          // seed a few lines below, before this fetch can possibly resolve —
          // apply the real value here too once it lands. Safe to do
          // unconditionally: this always resolves long before ET could have
          // produced its first real update (which needs the opening turn to
          // finish playing, the user to answer, and STT to finalize first).
          currentRungRef.current = settings.startingRung;
        }
      })
      .catch(() => {});

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
    clearPendingReveals();
    currentRungRef.current = conversationSettingsRef.current.startingRung;
    usedQuestionsRef.current = [];
    currentDomainRef.current = null;
    domainStreakRef.current = 0;
    setElapsed(0);
    setChatError(null);
    setIsThinking(false);
    bufferedTurnsRef.current = [];
    if (audioBlobUrlRef.current) {
      URL.revokeObjectURL(audioBlobUrlRef.current);
      audioBlobUrlRef.current = null;
    }
    setAudioBlob(null);

    // Create player and unlock AudioContext NOW — must be synchronous and
    // inside the click handler before any await, otherwise Chrome's autoplay
    // policy will block the AudioContext when the first TTS chunk arrives.
    // The MediaStreamDestinationNode (for session recording) is also created
    // here so it's ready when we connect the mic stream after Deepgram starts.
    playerRef.current = new StreamingAudioPlayer((amp) => {
      const wasSpeaking = isSpeakingRef.current;
      isSpeakingRef.current = amp > 0;
      // Raise the turn-VAD's threshold while the avatar is audible — echo
      // leaking back into the mic despite echoCancellation was getting
      // mistaken for a real user turn (see lib/turn-vad.ts).
      vadRef.current?.setAvatarSpeaking(amp > 0);
      // When the last audio chunk finishes playing, flush any queued user turns.
      // This is the correct moment — the SSE stream ends before audio finishes,
      // so flushing from the SSE callback would overlap with playback.
      if (wasSpeaking && amp === 0) {
        processBufferedRef.current();
        playbackDoneWaiterRef.current?.();
        playbackDoneWaiterRef.current = null;
      }
    }, scheduleWordReveal);
    playerRef.current.init();
    // Avatar-only (no mic) stream for the TalkingHead component's wawa-lipsync analysis.
    setAvatarAnalyser(playerRef.current.getAvatarAnalyser());

    // Open a dedicated mic stream for per-turn recording, session listen-back,
    // AND turn-boundary VAD (lib/turn-vad.ts taps this same stream below —
    // no separate getUserMedia call needed now that STT isn't a live SDK
    // with its own internal mic stream).
    try {
      // Fidelity-first constraints for the ASSESSMENT stream:
      // - noiseSuppression OFF: browser noise suppression is telephony-grade
      //   and strips broadband fricative energy (/s/ /θ/ /f/ /ʃ/) — exactly
      //   the phonemes pronunciation assessment needs intact.
      // - autoGainControl OFF: AGC pumping distorts phoneme energy; levels are
      //   normalised later in blobToWav16kMono instead.
      // - echoCancellation stays ON: it keeps the avatar's question (playing
      //   through the speakers while the turn recorder runs) out of the clip.
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
      if (playerRef.current) {
        playerRef.current.addMicStream(micStreamRef.current);
      }
    } catch (e) {
      console.warn("Mic stream for recording unavailable:", e);
    }

    // ── Turn-taking: client-side VAD (lib/turn-vad.ts) detects when the user
    // has stopped talking; Voxtral transcribes the recorded clip once it has
    // (app/api/transcribe, Mistral's dedicated transcription endpoint) ──────
    const onSpeechEnd = async () => {
      // H-01 latency instrumentation: mark the moment VAD considers the
      // utterance final, tagged with whether it's about to sit in the
      // buffer (avatar still busy) — that wait is turn-taking, not pipeline
      // latency, so keeping it visible lets the two be told apart later.
      const turnLogId = `turn-${++turnCounterRef.current}`;
      const willBuffer = isProcessingRef.current || isSpeakingRef.current;
      // Commit to the non-buffered path immediately, before the (new, blocking)
      // transcription call below — otherwise a second utterance that starts
      // while this one is still transcribing would ALSO compute willBuffer as
      // false (isProcessingRef only used to flip true inside handleUserTurn,
      // which doesn't run until after transcription resolves) and the two
      // turns would race instead of the second one correctly buffering.
      if (!willBuffer) isProcessingRef.current = true;

      // The examiner's question this turn answers — captured now, synchronously,
      // before any await, so ET (fired below) judges the same question this
      // turn's eventual reply answers regardless of what else happens on
      // historyRef while transcription is in flight.
      const questionContext =
        [...historyRef.current].reverse().find((m) => m.role === "assistant")?.content ?? "";

      // Always close out THIS utterance's recording the instant VAD detects
      // silence, regardless of whether the avatar is busy — the recorder must
      // be scoped to when the user actually spoke, not to whenever a buffered
      // turn eventually gets flushed. Deferring the stop/start to flush time
      // (the old behaviour) made the recorded window the gap between two
      // flushes — often under a second — instead of the real utterance,
      // producing near-empty recordings for any turn that got buffered.
      const recordingPromise = stopTurnRecording();
      startTurnRecording();

      const recording = await recordingPromise;
      if (!recording) return; // false-alarm VAD trigger — nothing was captured

      // Blocking: unlike ET/EO below, A/history/ET all need this text — see
      // doc/assessment_process.md's "non-blocking, best-effort" section for
      // why that's the exception here, not the rule elsewhere in this pipeline.
      let text = "";
      let wpm = 0;
      try {
        const form = new FormData();
        form.append("audio", recording.blob, "turn.webm");
        form.append("language", language);
        form.append("turnLogId", turnLogId);
        const res = await fetch("/api/transcribe", { method: "POST", body: form });
        if (!res.ok) throw new Error(`transcribe API error ${res.status}`);
        const data = (await res.json()) as { text: string; wpm: number };
        text = data.text;
        wpm = data.wpm;
      } catch (e) {
        console.error("Transcribe failed:", e);
        return;
      }
      if (!text.trim()) return; // no speech recognized

      logClientEvent("turn_stt_final", { turnLogId, buffered: willBuffer });

      // No more pass-1 SDK score (Azure used to supply one instantly) — EO's
      // pass-2 result (callPronunciationAPI below) overwrites this placeholder
      // in place, same mechanism as before, just with a neutral stand-in as
      // the starting value instead of a real (if lenient) Azure score.
      const pronunciation: PronunciationResult = {
        text, pronunciationScore: 0, accuracyScore: 0, wpm, words: [], source: "voxtral",
      };

      // ET (text-only, non-blocking/best-effort — see runTranscriptAssessment)
      // fires regardless of buffering: it only touches currentRungRef, never
      // history/turnIndex, so there's no ordering hazard with a turn that's
      // about to sit in the buffer below.
      void runTranscriptAssessment(text, questionContext, turnLogId);

      // Avatar is still talking or processing a previous turn — queue this
      // turn (its audio is already correctly captured above). All queued
      // turns are replayed in order once the avatar finishes speaking.
      // EO for a buffered turn still fires at flush time (processBufferedRef
      // below) rather than here, to keep its turnIndex (computed at flush
      // time, once this turn's position in history is actually known) correct.
      if (willBuffer) {
        bufferedTurnsRef.current.push({ text, pronunciation, recordingPromise, turnLogId });
        return;
      }

      setPartialUser("");

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

      // EO (needs the recording, not just text) fires here, non-blocking —
      // same endpoint/provider as before, now handed the real transcription
      // wpm instead of a live-SDK one.
      void callPronunciationAPI(recording.blob, turnIndex, wpm, text, questionContext, turnLogId);

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

      if (shouldEnd) {
        await deliverClosingRemarkAndEnd();
      }
    };

    // Barge-in: the user kept talking through lib/turn-vad.ts's BARGE_IN_MS
    // while the avatar was still speaking. Cut the avatar off immediately —
    // stop whatever's playing/queued and abort the /api/chat stream feeding
    // it more chunks — instead of letting it talk over the user to the end
    // of the sentence/reply. isSpeakingRef flips to false as a direct result
    // of player.interrupt()'s onAmplitudeChange(0) call below, so by the time
    // this utterance's onSpeechEnd fires it's processed immediately rather
    // than buffered (willBuffer reads isSpeakingRef/isProcessingRef).
    const handleBargeIn = () => {
      if (!isSpeakingRef.current) return; // avatar already finished — nothing to interrupt
      chatAbortControllerRef.current?.abort();
      playerRef.current?.interrupt();
    };

    // Start turn-taking — failure is non-fatal (avatar TTS still works).
    try {
      if (!micStreamRef.current) throw new Error("mic stream unavailable");
      vadRef.current = new TurnVad(micStreamRef.current, {
        onSpeechStart: () => {
          if (!isSpeakingRef.current) setPartialUser("…"); // listening indicator — no live captions without a streaming ASR
        },
        onSpeechEnd: () => { void onSpeechEnd(); },
        onBargeIn: handleBargeIn,
      });
      startTurnRecording(); // begin recording the first user turn

      // Session recording: TTS + mic audio mixed via the player's recordingDest.
      const ttsStream = playerRef.current?.getRecordingStream();
      recorderRef.current = new SessionRecorder(ttsStream ?? (micStreamRef.current ?? undefined));
    } catch (e) {
      console.error("Turn-taking VAD failed to start:", e);
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
    const process = chatProcessLabel(logId);
    // The opening line always targets A1 (the warm-up) regardless of
    // currentRungRef's default — everything after reads whatever ET's most
    // recently completed result set it to (best-effort, see runTranscriptAssessment).
    const rung: CefrRung = isStart ? "A1" : currentRungRef.current;

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
      clearPendingReveals();

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
      logClientEvent("turn_chat_request_sent", { turnLogId: logId, process, rung });
      const abortController = new AbortController();
      chatAbortControllerRef.current = abortController;
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          language,
          history: newHistory,
          userMessage,
          turnLogId: logId,
          rung,
          usedQuestions: usedQuestionsRef.current,
          isStart,
          avoidDomain: domainStreakRef.current >= MAX_DOMAIN_STREAK ? currentDomainRef.current ?? undefined : undefined,
        }),
        signal: abortController.signal,
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
            // Not rendered live anymore — the raw LLM token stream usually
            // finishes generating the whole reply before TTS/playback even
            // starts, so driving the caption off it showed the full answer
            // on screen well before any of it was audible. The caption is
            // now driven by scheduleWordReveal via the audio player's
            // onSentenceStart instead (see the "audio" branch below).
            // Still logged here for H-01 latency comparison against
            // turn_first_audio/the reveal timing.
            if (!loggedFirstText) {
              loggedFirstText = true;
              logClientEvent("turn_first_text", { turnLogId: logId, process });
            }
          } else if (type === "audio") {
            if (!loggedFirstAudio) {
              loggedFirstAudio = true;
              logClientEvent("turn_first_audio", { turnLogId: logId, process });
            }
            const { text: sentenceText, audio } = JSON.parse(data);
            playerRef.current?.playChunk(audio, sentenceText);
          } else if (type === "done") {
            logClientEvent("turn_stream_done", { turnLogId: logId, process });
            const { fullText, usedQuestions } = JSON.parse(data);
            // Defense in depth: an empty-content assistant message stuck in
            // history gets sent back to Mistral on every future turn, which
            // rejects it outright — never let one in, regardless of what the
            // server sends.
            if (fullText.trim()) {
              setHistory((h) => [...h, { role: "assistant", content: fullText }]);
              // TT (non-blocking) — the closing remark never asks a question,
              // so there's nothing to classify there. recentExchange gives the
              // classifier the prior Q&A so it can resolve references like
              // "the lifestyle you just described" that the bare question
              // text can't be classified from on its own.
              if (!isEnd) {
                const recentExchange = newHistory
                  .slice(-2)
                  .map((m) => `${m.role}: ${m.content}`)
                  .join("\n");
                void runTopicClassification(fullText, recentExchange, logId);
              }
            }
            if (usedQuestions) usedQuestionsRef.current = usedQuestions;
            // NOT clearing streamingAssistant here — the SSE stream ending
            // just means all audio bytes have been sent, not that playback
            // (and the word-by-word reveal riding on it) has finished. It's
            // cleared when the NEXT turn starts (see clearPendingReveals()
            // above). setIsThinking(false) is a safety net in case a turn
            // somehow produced text but no audio chunk ever arrived to
            // trigger the reveal's own setIsThinking(false).
            setIsThinking(false);
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
      isProcessingRef.current = false;
      setIsThinking(false);
      if (err instanceof Error && err.name === "AbortError") {
        // Deliberate: handleBargeIn() aborted this fetch because the user
        // started talking over the avatar. Not an error — the interrupting
        // turn (already being recorded) drives the next handleUserTurn call
        // once the VAD finalizes it, so don't flush the (now stale) buffer.
        return;
      }
      console.error("handleUserTurn failed:", err);
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
      return callPronunciationAPI(recording.blob, turnIndex, buffered.pronunciation.wpm ?? 0, buffered.text, questionContext, buffered.turnLogId);
    });
  };

  // ── end the session: stop everything, show the full-screen evaluating
  // takeover immediately, then evaluate and ALWAYS persist — this is now the
  // one and only way a session ends, so a failed evaluation must never
  // strand the user without a saved session.
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
    vadRef.current?.stop();
    chatAbortControllerRef.current?.abort();
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    // Stop session recorder BEFORE closing the player's AudioContext — the
    // combined stream is sourced from the player's MediaStreamDestinationNode,
    // so closing the AudioContext first would cut the stream before the
    // recorder can flush its final buffered chunk.
    const blob = await recorderRef.current?.stop() ?? null;
    playerRef.current?.stop();
    clearPendingReveals();
    setAvatarAnalyser(null);
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
            <TalkingHeadAvatar
              analyser={avatarAnalyser}
              audioContext={playerRef.current?.getAudioContext() ?? null}
            />

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
