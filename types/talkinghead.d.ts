// @met4citizen/talkinghead ships no TypeScript types. Minimal ambient
// declaration covering only the subset of its API this project actually uses.
declare module "@met4citizen/talkinghead" {
  export interface TalkingHeadAvatarSpec {
    url: string;
    body?: "M" | "F";
    lipsyncLang?: string;
    avatarMood?: string;
  }

  export interface TalkingHeadOptions {
    modelRoot?: string;
    cameraView?: "full" | "upper" | "mid" | "head";
    avatarMood?: string;
    [key: string]: unknown;
  }

  export interface TalkingHeadMorphTargetState {
    value: number;
    applied: number;
    needsUpdate: boolean;
    ms: unknown[];
    is: number[];
    // Bypasses the "system" channel's exponential smoothing ramp entirely —
    // applied immediately. This is the channel TalkingHead's own bundled
    // facetracking.mjs (a real-time webcam driver) uses, via direct
    // Object.assign(mtAvatar[key], {realtime, needsUpdate:true}) — there's no
    // public setter for it. See components/TalkingHeadAvatar.tsx.
    realtime: number | null;
  }

  export class TalkingHead {
    constructor(node: HTMLElement, opt?: TalkingHeadOptions);
    showAvatar(
      avatar: TalkingHeadAvatarSpec,
      onprogress?: (event: ProgressEvent) => void
    ): Promise<void>;
    setValue(morphTarget: string, value: number | null, ms?: number | null): void;
    getValue(morphTarget: string): number | undefined;
    start(): void;
    stop(): void;
    // Unlike stop() (pauses the animation loop only), dispose() actually
    // removes the canvas/WebGL renderer it created from the DOM. Required in
    // the effect cleanup — under React StrictMode's dev-mode double-invoke,
    // stop() alone leaves an orphaned canvas + a second, undriven instance
    // behind. See components/TalkingHeadAvatar.tsx.
    dispose(): void;
    // Real runtime properties (undocumented) — diagnostic-only access to
    // confirm the internal animation loop is running and that a given morph
    // target is actually mesh-wired. See components/TalkingHeadAvatar.tsx.
    isRunning: boolean;
    mtAvatar: Record<string, TalkingHeadMorphTargetState>;
    // The loaded GLB's root node (named per `opt.modelRoot`, "Armature" by
    // default) — a THREE.Object3D. Untyped here (no three.js dep in this
    // ambient module) since we only need .traverse() to hide body/outfit
    // meshes. See components/TalkingHeadAvatar.tsx.
    armature: { traverse(callback: (obj: any) => void): void } | null;
    // Plain flag the animation loop reads every frame (talkinghead.mjs) to
    // pick the idle vs. speaking head-move/eye-contact/body-sway templates.
    // Normally set internally by speakAudio()/speakText() — we bypass both
    // (audio-driven lip-sync only, see the effect below) and set this
    // directly instead. See components/TalkingHeadAvatar.tsx.
    isSpeaking: boolean;
    // Plays a short named animation (built-in gestures like "yes"/"no", or
    // hand emoji gestures) — used here to trigger a small nod while the user
    // is talking. See components/TalkingHeadAvatar.tsx.
    playGesture(name: string, dur?: number, mirror?: boolean, ms?: number): void;
    stopGesture(ms?: number): void;
    // Per-morph-target min/max override maps, read once per morph target when
    // showAvatar() builds its internal state (talkinghead.mjs's mtTemp
    // construction) — every frame's final `.applied` value is clipped to
    // this range. Mutated in place, before showAvatar(), to hard-cap how far
    // headRotateX/Y/Z can swing regardless of what internal logic (idle
    // look-away, a gesture, ...) computed for them. See components/TalkingHeadAvatar.tsx.
    mtMinExceptions: Record<string, number>;
    mtMaxExceptions: Record<string, number>;
    // Per-mood animation templates (body sway ranges, pose-change frequency,
    // etc.) — a plain object, mutated in place to tone down the built-in
    // "neutral" mood's idle sway. See components/TalkingHeadAvatar.tsx.
    animMoods: Record<string, any>;
    // Shared idle/speaking eye-contact + gaze-wander template (referenced
    // from inside animMoods' own anims array) — mutated in place to shrink
    // how far the eyes/head swing during a "glance away" cycle.
    // See components/TalkingHeadAvatar.tsx.
    animTemplateEyes: Record<string, any>;
    // Named gesture/emoji-reaction templates (e.g. "yes"/"no" head nods,
    // hand gestures) — mutated in place to soften the built-in "yes" nod's
    // amplitude. See components/TalkingHeadAvatar.tsx.
    animEmojis: Record<string, any>;
  }
}

declare module "wawa-lipsync" {
  export interface LipsyncFeature {
    bands: number[];
    deltaBands: number[];
    volume: number;
    centroid: number;
  }

  export enum VISEMES {
    sil = "viseme_sil",
    PP = "viseme_PP",
    FF = "viseme_FF",
    TH = "viseme_TH",
    DD = "viseme_DD",
    kk = "viseme_kk",
    CH = "viseme_CH",
    SS = "viseme_SS",
    nn = "viseme_nn",
    RR = "viseme_RR",
    aa = "viseme_aa",
    E = "viseme_E",
    I = "viseme_I",
    O = "viseme_O",
    U = "viseme_U",
  }

  export class Lipsync {
    features: LipsyncFeature | null;
    viseme: VISEMES;
    // Real runtime properties (marked `private` in the package's own types,
    // but TS `private` is compile-time only) — needed because we point
    // Lipsync at an externally-owned AudioContext/AnalyserNode (the one
    // StreamingAudioPlayer already plays TTS audio through) instead of
    // letting it create and manage its own via connectAudio()/
    // connectMicrophone(), neither of which fits a live in-app audio graph.
    // sampleRate/binWidth/dataArray must be recomputed to match whatever
    // analyser is assigned, since the constructor derives them from its own
    // (in our case, discarded) AudioContext. See components/TalkingHeadAvatar.tsx.
    audioContext: AudioContext;
    analyser: AnalyserNode;
    sampleRate: number;
    binWidth: number;
    dataArray: Uint8Array;
    // Real runtime state/methods (public in the actual class, just not
    // surfaced as "the API") — detectState() (called internally by
    // processAudio()) uses these same four to compute a full per-viseme
    // score distribution and then collapses it to a single argmax winner
    // (the public `.viseme`). We replicate that same computation ourselves
    // to get the full distribution, so we can blend the top few candidate
    // visemes each frame instead of hard-switching to one "winner" —
    // produces noticeably smoother, more natural mouth movement than
    // winner-takes-all. See components/TalkingHeadAvatar.tsx.
    history: LipsyncFeature[];
    getAveragedFeatures(): LipsyncFeature;
    computeVisemeScores(
      latest: LipsyncFeature,
      averaged: LipsyncFeature,
      deltaVolume: number,
      deltaCentroid: number
    ): Record<VISEMES, number>;
    adjustScoresForConsistency(scores: Record<VISEMES, number>): Record<VISEMES, number>;
    constructor(params?: { fftSize: number; historySize: number });
    connectAudio(audio: HTMLMediaElement): void;
    connectMicrophone(): Promise<MediaStreamAudioSourceNode>;
    processAudio(): void;
  }
}
