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

// Local avatar (public/avatars/) — must export the ARKit + Oculus viseme
// blendshapes TalkingHead's rig requires, or lip-sync will silently fail.
const DEFAULT_AVATAR_URL = "/avatars/woman_2.glb";

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
  /**
   * Whether the avatar's own TTS audio is currently playing. We drive
   * lip-sync ourselves (see below) rather than through TalkingHead's own
   * speakAudio()/speakText(), so its internal `isSpeaking` flag — which its
   * animation loop uses to pick idle vs. speaking head-move/eye-contact/body
   * -sway behaviour — would otherwise never be set. Forwarded to head.isSpeaking.
   */
  isAvatarSpeaking?: boolean;
  /**
   * Whether the user is currently talking (turn-boundary VAD's onSpeechStart/
   * onSpeechEnd — see lib/turn-vad.ts), used to trigger an occasional small
   * nod so the avatar reads as listening rather than just idling.
   */
  isUserSpeaking?: boolean;
}

export function TalkingHeadAvatar({
  analyser,
  audioContext,
  isAvatarSpeaking = false,
  isUserSpeaking = false,
}: TalkingHeadAvatarProps) {
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
        // While the avatar is speaking (head.isSpeaking, mirrored from
        // isAvatarSpeaking below): don't re-aim the head at a new idle
        // target, and hold eye contact instead — reads as "looking directly
        // at the user" rather than glancing around mid-sentence.
        avatarSpeakingHeadMove: 0,
        avatarSpeakingEyeContact: 1,
        // Default (0.2) picks the "look at camera" branch only 20% of idle
        // cycles — the other 80% is pure gaze wander with no camera target
        // at all (animTemplateEyes' fallback alt below). Raised so idle
        // moments (listening + thinking pauses) mostly hold eye contact too,
        // with only occasional glances away.
        avatarIdleEyeContact: 0.8,
        // Default (0.5) is a coin-flip, per idle cycle (every ~2-10s), for
        // whether TalkingHead's engine queues an actual head-turn animation
        // (headRotateY/X/Z, engine-internal jitter — not template data, so
        // it can't be tuned by shrinking a range like the ones above). That
        // turn also forces eye contact off for its ~4-8s duration regardless
        // of avatarIdleEyeContact, which is why raising eye contact alone
        // didn't stop the head turning away — this is the actual switch for
        // that behaviour. Dropped hard so it's an occasional accent, not a
        // near-constant one.
        avatarIdleHeadMove: 0.08,
      });
      headRef.current = head;

      // Even the "look at camera" branch of animTemplateEyes queues a real,
      // absolute eyesRotateY/X offset for several seconds each cycle (up to
      // +/-0.6 rad) — eyeContact being "on" is a separate flag from this
      // rotation, so a high avatarIdleEyeContact/avatarSpeakingEyeContact
      // alone doesn't stop the eyes visibly darting aside. Shrink the wander
      // range itself, for both branches (with vs. without eye contact) and
      // both idle/speaking states, so any glance away stays subtle.
      const eyesTemplate = head.animTemplateEyes as any;
      for (const state of ["idle", "speaking"]) {
        for (const alt of eyesTemplate?.[state]?.alt ?? []) {
          if (alt.vs?.eyesRotateY) alt.vs.eyesRotateY = alt.vs.eyesRotateY.map((v: any) => (Array.isArray(v) ? [-0.2, 0.2] : v));
          if (alt.vs?.eyesRotateX) alt.vs.eyesRotateX = alt.vs.eyesRotateX.map((v: any) => (Array.isArray(v) ? [-0.1, 0.2] : v));
        }
      }

      // The built-in "yes" gesture (used for the listening nod below) pairs
      // a headRotateX nod with a random headRotateZ left-right tilt — the
      // tilt is what made even the previously-shrunk version still read as a
      // head-shake rather than a small nod, so it's dropped entirely rather
      // than just shrunk further. headRotateX (the actual up/down nod) also
      // shrunk again — 0.02-0.04 was still described as "too pronounced".
      const yesGesture = head.animEmojis?.yes as any;
      if (yesGesture) {
        yesGesture.vs.headRotateX = [[0.01, 0.02], 0.01, [0.01, 0.02], 0];
        yesGesture.vs.headRotateZ = [0];
      }

      // Real session logs (avatar_head_turn) showed the idle look-away head
      // turn (talkinghead.mjs's isHeadMove branch, triggered by
      // avatarIdleHeadMove above) can hit ~0.27 rad (~15 degrees) — that
      // branch computes its target from live eye-look state at the moment,
      // not from a template range we can shrink like the ones above, so
      // there's no data-driven way to cap ITS amplitude specifically.
      // Instead, hard-clamp the min/max bounds every morph target is already
      // clipped to at the end of each frame (talkinghead.mjs ~line
      // 1707-1708) — read once, here, before showAvatar() builds each morph
      // target's state from these exception maps. This caps ANY future
      // source of head rotation (idle look-away, the nod above, anything
      // else), not just the one case we happened to measure.
      head.mtMinExceptions.headRotateY = -0.1;
      head.mtMaxExceptions.headRotateY = 0.1;
      head.mtMinExceptions.headRotateX = -0.08;
      head.mtMaxExceptions.headRotateX = 0.08;
      head.mtMinExceptions.headRotateZ = -0.06;
      head.mtMaxExceptions.headRotateZ = 0.06;

      // The built-in "neutral" mood's idle body sway (bodyRotateY up to
      // +/-0.3 rad) reads as much larger than intended under this component's
      // tight "head" camera crop — mutated in place (animMoods is a plain
      // object; `head.mood` already points at this same nested object once
      // set, so no need to re-call setMood) rather than replacing the whole
      // built-in mood.
      const headSway = head.animMoods?.neutral?.anims?.find((a: any) => a.name === "head");
      if (headSway) {
        headSway.idle.vs.bodyRotateX = [[-0.02, 0.05]];
        headSway.idle.vs.bodyRotateY = [[-0.12, 0.12]];
        headSway.idle.vs.bodyRotateZ = [[-0.04, 0.04]];
        // Near-still while speaking — head.isSpeaking (mirrored from
        // isAvatarSpeaking below) already halves this template's loop rate,
        // but the amplitude itself still needs flattening or it periodically
        // sways noticeably mid-sentence.
        headSway.speaking.vs.bodyRotateX = [[-0.01, 0.02]];
        headSway.speaking.vs.bodyRotateY = [[-0.02, 0.02]];
        headSway.speaking.vs.bodyRotateZ = [[-0.02, 0.02]];
      }

      // One-time snapshot of every head-movement tuning knob above, shipped
      // to logs/server-*.log — so a recorded session can later be correlated
      // against exactly what config was live when it was captured, without
      // having to cross-reference the git history of this file.
      logClientEvent("avatar_motion_config", {
        avatarIdleEyeContact: 0.8,
        avatarSpeakingEyeContact: 1,
        avatarIdleHeadMove: 0.08,
        avatarSpeakingHeadMove: 0,
        eyesRotateY_range: "[-0.2,0.2]",
        eyesRotateX_range: "[-0.1,0.2]",
        nodHeadRotateX: "[[0.01,0.02],0.01,[0.01,0.02],0]",
        nodHeadRotateZ: "none (dropped)",
        headSwayIdle: "X:[-0.02,0.05] Y:[-0.12,0.12] Z:[-0.04,0.04]",
        headSwaySpeaking: "X:[-0.01,0.02] Y:[-0.02,0.02] Z:[-0.02,0.02]",
        headRotateClamp: "X:[-0.08,0.08] Y:[-0.1,0.1] Z:[-0.06,0.06]",
      });

      const avatarUrl = process.env.NEXT_PUBLIC_AVATAR_GLB_URL || DEFAULT_AVATAR_URL;
      await head.showAvatar({ url: avatarUrl });
      loaded = true;

      // TalkingHead's own eye-contact logic (talkinghead.mjs's isEyeContact
      // branch, triggered whenever avatarIdleEyeContact/avatarSpeakingEyeContact
      // fire) does `Object.assign(this.mtAvatar['eyeLookInLeft'], {...})` etc.
      // with NO guard for a model missing that shape — unlike a couple of
      // other shapes it can synthesize (eyesLookUp/eyesLookDown), these 4
      // standard ARKit eye-look targets have no fallback. On an avatar that
      // doesn't export them, mtAvatar[name] is undefined and that call throws
      // "Cannot convert undefined or null to object" — inside TalkingHead's
      // OWN internal animation loop, not the lip-sync tick() below, so our
      // try/catch there can't catch it. That loop then dies permanently and
      // silently, taking the mouth (and everything else it drives) down with
      // it — this is what caused "plays fine for one sentence, then the
      // mouth freezes" once we raised the eye-contact probabilities enough
      // for this branch to actually run. Seed a harmless no-op stub (empty
      // mesh-index lists, so nothing visibly changes) for whichever of these
      // are missing, the same technique TalkingHead itself uses for its own
      // synthesized fallback shapes.
      const REQUIRED_EYE_LOOK_TARGETS = ["eyeLookInLeft", "eyeLookOutLeft", "eyeLookInRight", "eyeLookOutRight"];
      const missingEyeLookTargets = REQUIRED_EYE_LOOK_TARGETS.filter((name) => !head!.mtAvatar[name]);
      for (const name of missingEyeLookTargets) {
        (head.mtAvatar as any)[name] = {
          fixed: null, realtime: null, system: null, systemd: null, newvalue: null, ref: null,
          min: 0, max: 1, base: null, v: 0, needsUpdate: false, value: 0, applied: 0,
          baseline: 0, ms: [], is: [],
          // Both MUST be null, not just absent/undefined — the engine's per-frame
          // update loop (talkinghead.mjs ~line 1693/1696) checks `o.limit !== null`
          // and, if that passes, calls `o.limit(o.value)` unconditionally; leaving
          // this field out entirely (as an earlier version of this stub did) made
          // that check pass with `undefined`, then threw "o.limit is not a
          // function" on the very next frame that touched this shape (i.e. the
          // instant it started talking) — same class of bug as the eyeLookIn/Out
          // crash itself, just one field of the mock object away.
          limit: null, onchange: null,
        };
      }
      if (missingEyeLookTargets.length > 0) {
        console.warn("[TalkingHeadAvatar] avatar model is missing eye-look morph targets, stubbed to avoid a crash:", missingEyeLookTargets);
        logClientEvent("avatar_missing_morph_targets", { avatarUrl, missing: missingEyeLookTargets.join(",") });
      }

      // The "head" cameraView only crops the *framing* — the full-body mesh
      // (T-posed arms, legs, shoes) is still there and pokes into frame right
      // behind the head. Hide everything but the face/head-adjacent meshes by
      // their standard RPM material names (works across any RPM export).
      const HIDDEN_MATERIALS = new Set([
        "Wolf3D_Body",
        "Wolf3D_Outfit_Top",
        "Wolf3D_Outfit_Bottom",
        "Wolf3D_Outfit_Footwear",
      ]);
      head.armature?.traverse((obj: any) => {
        if (!obj.isMesh && !obj.isSkinnedMesh) return;
        const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
        if (mat?.name && HIDDEN_MATERIALS.has(mat.name)) obj.visible = false;
      });

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

  // Mirror isAvatarSpeaking onto head.isSpeaking every time it changes.
  // headRef.current is assigned synchronously right after `new TalkingHead()`
  // above (before the async showAvatar() call resolves), so this is safe to
  // set regardless of load order — TalkingHead's own animation loop just
  // reads the flag each frame, it doesn't need to be "ready" first.
  useEffect(() => {
    if (headRef.current) headRef.current.isSpeaking = isAvatarSpeaking;
    // Cheap — only fires on actual transitions, not every render — but
    // useful to overlay against the periodic avatar_status log below and
    // against logs/server-*.log's chat/TTS events, to see exactly when the
    // head-stillness/eye-contact behaviour switched relative to real speech.
    logClientEvent("avatar_speaking_state_change", {
      isAvatarSpeaking,
      tMs: Math.round(performance.now()),
    });
  }, [isAvatarSpeaking]);

  // While the user is talking, trigger an occasional small nod (the built-in
  // "yes" gesture — a short headRotateX/Z pulse, see talkinghead.mjs) so the
  // avatar reads as listening rather than just sitting idle. Randomized
  // interval so it doesn't look mechanical; skipped entirely if the avatar
  // starts talking mid-nod-cycle (isAvatarSpeaking already holds the head
  // still in that case, see the effect above).
  useEffect(() => {
    if (!isUserSpeaking) return;
    let timeout = 0;
    const scheduleNod = () => {
      const delayMs = 2200 + Math.random() * 1800;
      timeout = window.setTimeout(() => {
        const fired = Boolean(headRef.current) && !isAvatarSpeaking;
        if (fired) headRef.current!.playGesture("yes", 1);
        logClientEvent("avatar_nod", { fired, isAvatarSpeaking, tMs: Math.round(performance.now()) });
        scheduleNod();
      }, delayMs);
    };
    scheduleNod();
    return () => window.clearTimeout(timeout);
  }, [isUserSpeaking, isAvatarSpeaking]);

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

    // Ships a richer status snapshot to logs/server-*.log every ~2s (the
    // console.log below still fires every 500ms for live debugging, but
    // shipping THAT often over the network isn't worth it for a whole
    // session) — lets a recorded session's lip-sync/head-movement behaviour
    // be reconstructed afterwards instead of only in a live DevTools console.
    const SERVER_LOG_INTERVAL_MS = 2000;
    let lastServerLog = 0;

    // An uncaught exception anywhere in this function body would otherwise
    // permanently and silently kill the rAF loop — requestAnimationFrame(tick)
    // is the last line, so it would simply never get scheduled again, and the
    // mouth would freeze with no error visible unless DevTools happened to be
    // open. Wrapping the frame's work below means a bug degrades to "one
    // logged, dropped frame" instead, and — critically — leaves a record in
    // logs/server-*.log of exactly when and why it happened.
    const TICK_ERROR_LOG_COOLDOWN_MS = 3000;
    let lastTickErrorLoggedAt = 0;

    // Discrete head-turn logging: samples the SAME headRotateX/Y/Z morph
    // targets TalkingHead's own engine drives internally when its idle
    // head-move logic fires (see avatarIdleHeadMove above) — that engine
    // code is entirely internal (its own animate loop, no event/callback of
    // its own), so this is the only way to observe it. Edge-triggered on
    // headRotateY (the left/right component) crossing HEAD_TURN_THRESHOLD,
    // logging one "avatar_head_turn" event per excursion with its peak
    // amplitude and duration — answers "how often, and how far" after the
    // fact instead of only impressionistically.
    const HEAD_TURN_THRESHOLD = 0.03; // rad — below this reads as sway/jitter, not a turn
    let headTurnActive = false;
    let headTurnStartMs = 0;
    let headTurnPeakY = 0;
    let headTurnPeakX = 0;
    let headTurnPeakZ = 0;

    let raf = 0;
    let lastLog = 0;
    const tick = () => {
      try {
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

        if (head) {
          const rotY = head.mtAvatar.headRotateY?.applied ?? 0;
          const rotX = head.mtAvatar.headRotateX?.applied ?? 0;
          const rotZ = head.mtAvatar.headRotateZ?.applied ?? 0;
          const turning = Math.abs(rotY) > HEAD_TURN_THRESHOLD;
          if (turning && !headTurnActive) {
            headTurnActive = true;
            headTurnStartMs = performance.now();
            headTurnPeakY = rotY;
            headTurnPeakX = rotX;
            headTurnPeakZ = rotZ;
          } else if (turning && headTurnActive) {
            if (Math.abs(rotY) > Math.abs(headTurnPeakY)) headTurnPeakY = rotY;
            if (Math.abs(rotX) > Math.abs(headTurnPeakX)) headTurnPeakX = rotX;
            if (Math.abs(rotZ) > Math.abs(headTurnPeakZ)) headTurnPeakZ = rotZ;
          } else if (!turning && headTurnActive) {
            headTurnActive = false;
            logClientEvent("avatar_head_turn", {
              durationMs: Math.round(performance.now() - headTurnStartMs),
              peakHeadRotateY: Math.round(headTurnPeakY * 1000) / 1000,
              peakHeadRotateX: Math.round(headTurnPeakX * 1000) / 1000,
              peakHeadRotateZ: Math.round(headTurnPeakZ * 1000) / 1000,
              direction: headTurnPeakY > 0 ? "right" : "left",
              // head.isSpeaking (kept in sync by the effect above), not the
              // isAvatarSpeaking prop directly — this effect only depends on
              // [analyser, audioContext], so a closured prop value here would
              // be stuck at whatever it was when the effect was created.
              isAvatarSpeaking: head.isSpeaking,
            });
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

        if (now - lastServerLog > SERVER_LOG_INTERVAL_MS) {
          lastServerLog = now;
          logClientEvent("avatar_status", {
            tMs: Math.round(now),
            audioContextState: audioContext.state,
            rawAnalyserPeak: rawBuf.length ? Math.max(...rawBuf) : null,
            wawaVolume: lipsync.features?.volume ?? null,
            wawaViseme: active,
            activeViseme_applied: head?.mtAvatar?.[active]?.applied ?? null,
            headIsSpeaking: head?.isSpeaking ?? null,
            frameGapMs: Math.round(frameGapMs),
          });
        }
      } catch (e) {
        const now = performance.now();
        if (now - lastTickErrorLoggedAt > TICK_ERROR_LOG_COOLDOWN_MS) {
          lastTickErrorLoggedAt = now;
          console.error("[TalkingHeadAvatar] tick() error (frame dropped, loop continues):", e);
          logClientEvent("avatar_tick_error", {
            error: String(e),
            stack: e instanceof Error ? (e.stack ?? "").slice(0, 500) : undefined,
          });
        }
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
