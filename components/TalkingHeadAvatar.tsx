"use client";

import { useEffect, useRef, useState } from "react";
import { TalkingHead } from "@met4citizen/talkinghead";
import { Lipsync, VISEMES } from "wawa-lipsync";
import { logClientEvent } from "@/lib/client-log";

const VISEME_NAMES = Object.values(VISEMES);

// This whole driving scheme is ported from TalkingHead's OWN canonical
// viseme-playback code (modules/talkinghead.mjs, its text/timestamp-driven
// pipeline) rather than invented — that's the one place these ARKit/Oculus
// blendshapes have already been tuned by the library author against real
// RPM rigs. Two things it does that we'd gotten wrong by inventing our own
// scheme:
//
// 1. jawOpen is NEVER driven by lipsync. It only appears in mood/emoji
//    expressions there, plus a compatibility shim for avatars missing the
//    mouthOpen blendshape. The viseme shapes themselves (viseme_aa,
//    viseme_O, ...) are sculpted as full mouth shapes on a real RPM rig and
//    already carry the jaw-drop — they don't need a second, independently
//    driven jawOpen stacked on top. Our old JAW_COUPLING/envelope pair was
//    fighting itself: exactly the "high baseline" the visuals showed.
// 2. Each viseme is driven to a flat, fixed target — 0.9 for PP/FF, 0.6 for
//    everything else — not scaled by a per-frame loudness envelope. The
//    only volume-based adjustment is a small +/-50% multiplier applied
//    ONLY to open vowels (aa/E/I/O/U): `newvalue *= 1 + vol/255 - 0.5`.
//    Naturalness there comes from TalkingHead's own acceleration-limited
//    easing holding each viseme for a realistic ~150-200ms dwell (driven by
//    real word timing), not from scaling amplitude every 16ms.
//
// We also stick to a single active viseme per frame (wawa-lipsync's own
// public `.viseme`), not a multi-viseme blend — blending e.g. viseme_O
// (rounded/pucker) with viseme_E (spread) at high combined weight, which an
// earlier version of this file did via wawa-lipsync's private scoring
// internals, isn't how either library actually drives these blendshapes and
// produced a "duck face" pucker. The per-viseme smoothing below still
// crossfades naturally when the winner changes frame to frame.
const FIXED_INTENSITY: Record<string, number> = Object.fromEntries(
  VISEME_NAMES.map((name) => [name, name === "viseme_PP" || name === "viseme_FF" ? 0.9 : 0.6])
);
const VOWEL_VISEMES = new Set(["viseme_aa", "viseme_E", "viseme_I", "viseme_O", "viseme_U"]);

// wawa-lipsync's "volume" is not RMS — it's the average of 7 spectral-band
// energies, each already normalized 0-1. Logged real TTS playback through
// this signal chain: true silence reads ~0, but ordinary voiced speech
// clusters between ~0.27 and ~0.46 — a narrow band, not spread across 0-1.
// Normalizing that observed [floor, ceil] range to 0-1 gives a `normalizedVolume`
// standing in for TalkingHead's own `vol/255` term in its +/-50% vowel
// modulation above.
const VOLUME_FLOOR = 0.06; // at/below this, treat as silence (matches observed near-silence dips)
const VOLUME_CEIL = 0.5; // at/above this, volume modulation is fully open (matches observed loud-vowel peaks)

// Local placeholder avatar (public/avatars/) — exports the ARKit + Oculus
// viseme blendshapes TalkingHead's rig requires. Used until a
// persona-matched avatar is exported and NEXT_PUBLIC_AVATAR_GLB_URL is set.
const DEFAULT_AVATAR_URL = "/avatars/brunette-t.glb";

interface TalkingHeadAvatarProps {
  /**
   * TTS-only AnalyserNode + its AudioContext (StreamingAudioPlayer.
   * getAvatarAnalyser()/getAudioContext()) — the exact signal already
   * playing to the speakers, tapped directly in the same audio graph.
   * TalkingHead does not do audio-driven lip-sync itself — wawa-lipsync
   * analyzes this in real time and drives the avatar's viseme blendshapes
   * directly, which works the same regardless of language.
   */
  analyser: AnalyserNode | null;
  audioContext: AudioContext | null;
}

export function TalkingHeadAvatar({ analyser, audioContext }: TalkingHeadAvatarProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<TalkingHead | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  // Mount TalkingHead and load the avatar once.
  useEffect(() => {
    let mounted = true;
    let loaded = false;
    let head: TalkingHead | null = null;

    async function init() {
      if (!containerRef.current) return;
      const loadStartedAt = performance.now();
      logClientEvent("avatar_load_start", {});
      head = new TalkingHead(containerRef.current, {
        modelRoot: "Armature",
        cameraView: "head",
        // Zooms the camera out from the "head" view's default framing so
        // the rendered head reads smaller within the (unchanged-size) panel
        // — closer to a normal video-call framing than a tight close-up.
        cameraDistance: 0.7,
        avatarMood: "neutral",
        // We only use audio-driven lip-sync (wawa-lipsync), never TalkingHead's
        // own text-driven mode — skip its default eager preload of the
        // fi/en/lt phoneme dictionary modules (via dynamic import()), which
        // Next.js's webpack build doesn't resolve correctly for this package.
        lipsyncModules: [],
      });
      headRef.current = head;

      const avatarUrl = process.env.NEXT_PUBLIC_AVATAR_GLB_URL || DEFAULT_AVATAR_URL;
      await head.showAvatar({ url: avatarUrl });
      loaded = true;

      if (!mounted) {
        // Cleanup already ran while showAvatar() was still in flight — it
        // couldn't safely dispose() then (see below), so finish the job now
        // that loading has actually completed.
        head.dispose();
        if (headRef.current === head) headRef.current = null;
        return;
      }

      setStatus("ready");

      // Diagnostic: does TalkingHead actually recognize these morph targets
      // on THIS model? getValue() returns undefined if the name was never
      // registered (wrong rig/root name, model not skinned as expected,
      // etc.) — if so, setValue() calls later are silent no-ops regardless
      // of what the audio analysis produces.
      const probe = ["viseme_PP", "viseme_aa", "viseme_O", "jawOpen"];
      console.log(
        "[TalkingHeadAvatar] avatar loaded:",
        avatarUrl,
        "— morph target registration check:",
        Object.fromEntries(probe.map((mt) => [mt, head!.getValue(mt)]))
      );
      logClientEvent("avatar_load_complete", { avatarUrl, durationMs: Math.round(performance.now() - loadStartedAt) });
    }

    init().catch((e) => {
      console.error("[TalkingHeadAvatar] init failed:", e);
      logClientEvent("avatar_load_failed", { error: String(e) });
      if (mounted) setStatus("error");
    });

    return () => {
      mounted = false;
      // dispose(), not stop() — stop() only pauses the animation loop and
      // leaves the canvas/renderer in the DOM. Under React StrictMode's
      // dev-mode double-invoke (mount -> cleanup -> mount again), stop()
      // alone orphaned the first instance's canvas while a second, undriven
      // instance took over — idle animation (blink/head-sway) still looked
      // fine since *an* instance was running, but our lip-sync code was
      // driving whichever instance headRef.current pointed to, which wasn't
      // necessarily the one actually left visible on screen. Confirmed via
      // logs: real audio, real classification, real applied values (0.6+),
      // zero visible movement — a proper dispose() is the fix.
      //
      // dispose() itself touches state (armature, poseAvatar, ...) that's
      // only set up partway through the async showAvatar() call — calling it
      // before that finishes throws. If loading hasn't completed yet, init()'s
      // own continuation above disposes it as soon as showAvatar() resolves.
      if (loaded) head?.dispose();
      headRef.current = null;
    };
  }, []);

  // Analyze the avatar's own playing audio in real time and drive its
  // viseme blendshapes directly — language-independent, no server changes.
  //
  // wawa-lipsync's own `new Lipsync()` creates its own throwaway AudioContext
  // + AnalyserNode and expects you to feed it via connectAudio()/
  // connectMicrophone() (file URL or mic only — neither fits here). Instead
  // we discard its self-created context and point it at the analyser
  // StreamingAudioPlayer already maintains, in the SAME AudioContext that's
  // actually playing the TTS audio to the speakers — no MediaStream bridging,
  // no second AudioContext, no separate element. `analyser`/`audioContext`
  // are real runtime properties (only marked `private` in wawa-lipsync's own
  // types); sampleRate/binWidth/dataArray must be recomputed to match the
  // analyser we hand it, since the constructor computed them from the
  // now-discarded context.
  useEffect(() => {
    if (!analyser || !audioContext) return;

    const lipsync = new Lipsync();
    const orphanedContext = lipsync.audioContext;
    lipsync.audioContext = audioContext;
    lipsync.analyser = analyser;
    lipsync.sampleRate = audioContext.sampleRate;
    lipsync.binWidth = audioContext.sampleRate / analyser.fftSize;
    lipsync.dataArray = new Uint8Array(analyser.frequencyBinCount);
    orphanedContext.close().catch(() => {});

    console.log("[TalkingHeadAvatar] lipsync wired:", {
      audioContextState: audioContext.state,
      audioContextSampleRate: audioContext.sampleRate,
      analyserFftSize: analyser.fftSize,
      analyserFrequencyBinCount: analyser.frequencyBinCount,
      binWidth: lipsync.binWidth,
    });
    logClientEvent("avatar_lipsync_wired", {
      audioContextState: audioContext.state,
      audioContextSampleRate: audioContext.sampleRate,
    });

    // Raw, independent-of-wawa peek at the analyser — distinguishes "no audio
    // signal is reaching the analyser at all" (upstream/wiring problem) from
    // "signal arrives but wawa's own classification/volume stays ~0"
    // (wawa-side problem) from "wawa reports real values but the mesh still
    // doesn't move" (TalkingHead/model problem).
    const rawBuf = new Uint8Array(analyser.frequencyBinCount);

    // Confirmed by logging: TalkingHead's public setValue() drives its
    // "system" channel, which ramps toward a target via a velocity that
    // builds up over consecutive frames — designed for a viseme held steady
    // over a real ~100-300ms window (its own speakAudio()/timeline system).
    // We re-pick a "winning" viseme every single animation frame from
    // wawa-lipsync's raw per-frame classification, which is noisy enough
    // that no single target survives long enough for that ramp to rise past
    // a fraction of a percent — confirmed: applied values around 0.008 out
    // of a 0-1 range, technically working, invisible in practice.
    //
    // Fix: drive the "realtime" channel instead — the one TalkingHead's own
    // bundled facetracking.mjs (a real-time webcam driver) uses for exactly
    // this kind of continuous per-frame input. It applies immediately, no
    // ramp. There's no public setter for it (facetracking.mjs itself reaches
    // directly into mtAvatar), so we do the same. We add our own light
    // smoothing on top (independent of TalkingHead's) so switching between
    // visemes every frame doesn't look like a strobe light.
    const currentIntensity: Record<string, number> = Object.fromEntries(
      VISEME_NAMES.map((name) => [name, 0])
    );
    const SMOOTHING = 0.28; // higher = snappier/twitchier, lower = smoother/laggier

    // Rolling buffer of recent ticks, dumped as a single JSON string so it
    // can be copy-pasted directly from the console without expanding nested
    // objects — each printed line already contains the last ~20s of history.
    const logBuffer: Record<string, unknown>[] = [];
    const LOG_BUFFER_MAX = 40;

    // Frame-stall detection: this rAF loop runs continuously for the whole
    // session (see the module-level note above), on the same main JS thread
    // as SSE parsing, audio-chunk scheduling, and mic/STT processing. A gap
    // much bigger than one frame (~16.7ms at 60fps) between two ticks means
    // something else on that thread blocked it for a while — logged (with a
    // cooldown so a bad patch of jank doesn't flood the log with one POST
    // per frame) so a future "did the avatar make things sluggish" question
    // can be checked against logs/server-*.log instead of guessing.
    const STALL_THRESHOLD_MS = 200;
    const STALL_LOG_COOLDOWN_MS = 3000;
    let lastFrameAt = performance.now();
    let lastStallLoggedAt = 0;

    let raf = 0;
    let lastLog = 0;
    const tick = () => {
      const now0 = performance.now();
      const frameGapMs = now0 - lastFrameAt;
      lastFrameAt = now0;
      if (frameGapMs > STALL_THRESHOLD_MS && now0 - lastStallLoggedAt > STALL_LOG_COOLDOWN_MS) {
        lastStallLoggedAt = now0;
        logClientEvent("avatar_frame_stall", { gapMs: Math.round(frameGapMs) });
      }

      lipsync.processAudio();
      const head = headRef.current;
      // The single public, documented signal (wawa-lipsync's README shows
      // exactly this: read `.viseme` after processAudio(), nothing else).
      const active = lipsync.viseme;

      if (head) {
        const volume = lipsync.features?.volume ?? 0;
        // Stand-in for TalkingHead's own `vol/255` term (see FIXED_INTENSITY
        // comment above) — only used for the small vowel-only +/-50% nudge,
        // not as a global gate on every viseme like the old `envelope` was.
        const normalizedVolume = Math.min(1, Math.max(0, (volume - VOLUME_FLOOR) / (VOLUME_CEIL - VOLUME_FLOOR)));

        for (const name of VISEME_NAMES) {
          // viseme_sil never gets a target in TalkingHead's own pipeline
          // either — silence just means nothing drives the mouth, and it
          // relaxes back toward 0 on its own via the smoothing below.
          const base = name === "viseme_sil" ? 0 : FIXED_INTENSITY[name];
          const modulation = VOWEL_VISEMES.has(name) ? 0.5 + normalizedVolume : 1;
          const target = name === active ? Math.min(1, base * modulation) : 0;
          currentIntensity[name] += (target - currentIntensity[name]) * SMOOTHING;
          const mt = head.mtAvatar[name];
          if (mt) Object.assign(mt, { realtime: currentIntensity[name], needsUpdate: true });
        }
      }

      const now = performance.now();
      if (now - lastLog > 500) {
        lastLog = now;
        analyser.getByteFrequencyData(rawBuf);
        const rawPeak = Math.max(...rawBuf);
        const mt = head?.mtAvatar?.[active];
        logBuffer.push({
          t: Math.round(now / 100) / 10, // seconds since this effect started, 1 decimal
          audioContextState: audioContext.state,
          rawAnalyserPeak: rawPeak, // 0-255; stays 0 if no signal reaches the analyser at all
          wawaVolume: lipsync.features?.volume ?? null,
          wawaViseme: active,
          headIsRunning: head?.isRunning,
          activeViseme_realtime: mt?.realtime,
          activeViseme_applied: mt?.applied,
          activeViseme_meshCount: mt?.ms?.length,
        });
        if (logBuffer.length > LOG_BUFFER_MAX) logBuffer.shift();
        // Plain string, not an object — copy-pasteable straight from the
        // console with no expand-arrows needed.
        console.log("[TalkingHeadAvatar] recent ticks:", JSON.stringify(logBuffer));
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      // Release the realtime channel (matches facetracking.mjs's own
      // teardown pattern) so nothing is left permanently overriding these
      // morph targets after this effect stops driving them.
      const head = headRef.current;
      if (head) {
        for (const name of VISEME_NAMES) {
          const mt = head.mtAvatar[name];
          if (mt) Object.assign(mt, { realtime: null, needsUpdate: true });
        }
      }
    };
  }, [analyser, audioContext]);

  return (
    <div style={{ width: "100%", height: "100%", background: "#ffffff", position: "relative" }}>
      <img
        src="/images/elao-logo.svg"
        alt="ELAO"
        style={{ position: "absolute", top: 16, left: 16, width: 90, height: "auto" }}
      />
      {status === "loading" && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#475569",
            fontSize: 14,
          }}
        >
          Chargement de l&apos;avatar…
        </div>
      )}
      {status === "error" && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#ef4444",
            fontSize: 14,
          }}
        >
          Avatar indisponible
        </div>
      )}
      <div
        ref={containerRef}
        style={{ width: "100%", height: "100%", opacity: status === "ready" ? 1 : 0 }}
      />
    </div>
  );
}
