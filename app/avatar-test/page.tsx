"use client";

import { useEffect, useRef, useState } from "react";
import { TalkingHead } from "@met4citizen/talkinghead";
import { Lipsync, VISEMES } from "wawa-lipsync";

const VISEME_NAMES = Object.values(VISEMES);
const JAW_NAME = "jawOpen";
const JAW_MAX = 0.6;
const AVATAR_URL = process.env.NEXT_PUBLIC_AVATAR_GLB_URL || "/avatars/brunette-t.glb";

/**
 * Standalone avatar + lip-sync test bench — isolated from the live
 * conversation pipeline (no mic, no STT, no SSE) so we can iterate on
 * TalkingHead/wawa-lipsync directly against a static test MP3 and manual
 * "force this blendshape" buttons. Once something works here, port the same
 * approach back into components/TalkingHeadAvatar.tsx.
 */
export default function AvatarTestPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const headRef = useRef<TalkingHead | null>(null);
  const lipsyncRef = useRef<Lipsync | null>(null);
  const tickingRef = useRef(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [debug, setDebug] = useState<Record<string, unknown>>({});

  useEffect(() => {
    let mounted = true;
    let head: TalkingHead | null = null;

    async function init() {
      if (!containerRef.current) return;
      head = new TalkingHead(containerRef.current, {
        modelRoot: "Armature",
        cameraView: "head",
        avatarMood: "neutral",
        lipsyncModules: [],
      });
      headRef.current = head;
      await head.showAvatar({ url: AVATAR_URL });
      if (!mounted) return;
      setStatus("ready");
      const probe = ["viseme_PP", "viseme_aa", "viseme_O", "jawOpen", "mouthOpen"];
      console.log(
        "[avatar-test] loaded:",
        AVATAR_URL,
        Object.fromEntries(probe.map((mt) => [mt, head!.getValue(mt)]))
      );
    }

    init().catch((e) => {
      console.error("[avatar-test] init failed:", e);
      if (mounted) setStatus("error");
    });

    return () => {
      mounted = false;
      head?.stop();
      headRef.current = null;
    };
  }, []);

  /** Directly force one morph target to a fixed value, no audio involved at all. */
  function forceValue(name: string, value: number | null) {
    const head = headRef.current;
    if (!head) return;
    const mt = head.mtAvatar[name];
    if (!mt) {
      console.warn(`[avatar-test] no morph target registered for "${name}"`);
      return;
    }
    Object.assign(mt, { realtime: value, needsUpdate: true });
    console.log(`[avatar-test] forced ${name} -> ${value}`);
  }

  function releaseAll() {
    const head = headRef.current;
    if (!head) return;
    for (const name of [...VISEME_NAMES, JAW_NAME, "mouthOpen", "mouthSmile"]) {
      const mt = head.mtAvatar[name];
      if (mt) Object.assign(mt, { realtime: null, needsUpdate: true });
    }
  }

  function startAudioDrivenLipsync() {
    const audioEl = audioRef.current;
    const head = headRef.current;
    if (!audioEl || !head || tickingRef.current) return;
    tickingRef.current = true;

    const lipsync = new Lipsync();
    lipsyncRef.current = lipsync;
    // Real .src-based file — the textbook wawa-lipsync usage, no MediaStream
    // bridging needed (unlike the live conversation pipeline).
    lipsync.connectAudio(audioEl);

    const currentIntensity: Record<string, number> = Object.fromEntries(
      [...VISEME_NAMES, JAW_NAME].map((n) => [n, 0])
    );
    const SMOOTHING = 0.35;
    let lastUiUpdate = 0;

    function tick() {
      lipsync.processAudio();
      const active = lipsync.viseme;
      const volume = lipsync.features?.volume ?? 0;
      const targetIntensity = Math.min(1, volume * 3);
      for (const name of VISEME_NAMES) {
        const target = name === active ? targetIntensity : 0;
        currentIntensity[name] += (target - currentIntensity[name]) * SMOOTHING;
        const mt = head!.mtAvatar[name];
        if (mt) Object.assign(mt, { realtime: currentIntensity[name], needsUpdate: true });
      }
      const jawTarget = Math.min(JAW_MAX, volume * 3);
      currentIntensity[JAW_NAME] += (jawTarget - currentIntensity[JAW_NAME]) * SMOOTHING;
      const jawMt = head!.mtAvatar[JAW_NAME];
      if (jawMt) Object.assign(jawMt, { realtime: currentIntensity[JAW_NAME], needsUpdate: true });

      const now = performance.now();
      if (now - lastUiUpdate > 200) {
        lastUiUpdate = now;
        setDebug({
          active,
          volume: volume.toFixed(3),
          activeIntensity: currentIntensity[active]?.toFixed(3),
          activeApplied: head!.mtAvatar[active]?.applied?.toFixed(3),
          jawIntensity: currentIntensity[JAW_NAME].toFixed(3),
          jawApplied: jawMt?.applied?.toFixed(3),
        });
      }

      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "#0f172a",
        color: "#e2e8f0",
        fontFamily: "monospace",
      }}
    >
      <div style={{ padding: 12, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", borderBottom: "1px solid #334155" }}>
        <strong>Avatar test bench</strong>
        <span>status: {status}</span>
        <span>avatar: {AVATAR_URL}</span>
      </div>

      <div style={{ padding: 12, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", borderBottom: "1px solid #334155" }}>
        <span>Manual (no audio):</span>
        <button onClick={() => forceValue("jawOpen", 1)}>jawOpen = 1</button>
        <button onClick={() => forceValue("mouthOpen", 1)}>mouthOpen = 1</button>
        {VISEME_NAMES.map((name) => (
          <button key={name} onClick={() => forceValue(name, 1)}>
            {name} = 1
          </button>
        ))}
        <button onClick={releaseAll} style={{ background: "#7f1d1d" }}>
          release all
        </button>
      </div>

      <div style={{ padding: 12, display: "flex", gap: 8, alignItems: "center", borderBottom: "1px solid #334155" }}>
        <span>Audio-driven:</span>
        <audio ref={audioRef} src="/audio/test-sample.mp3" controls />
        <button onClick={startAudioDrivenLipsync}>start lip-sync analysis</button>
      </div>

      <div style={{ flex: 1, position: "relative", minHeight: 300 }}>
        <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
      </div>

      <pre style={{ padding: 12, fontSize: 12, maxHeight: 150, overflow: "auto", borderTop: "1px solid #334155" }}>
        {JSON.stringify(debug, null, 2)}
      </pre>
    </div>
  );
}
