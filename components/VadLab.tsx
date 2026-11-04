"use client";

import { useEffect, useRef, useState } from "react";
import { TurnVad } from "@/lib/turn-vad";
import { SileroVad } from "@/lib/silero-vad";
import type { CefrZone } from "@/lib/cefr-rung";
import { pickRecorderMimeType } from "@/lib/session-recorder";
import { assessRoom, rmsToDb, NOISE_CHECK_WINDOW, type RoomAssessment } from "@/lib/noise-check";
import { adminColors } from "@/lib/admin-theme";
import styles from "./admin.module.css";

/**
 * Admin VAD lab (doc/feature-1-background-noise-plan.md): opens the mic with
 * chosen browser processing constraints and runs the live turn detector
 * (lib/turn-vad.ts, unchanged) on it, so background-noise handling can be
 * tried by ear — cough after an answer, music, a door — without running a
 * whole session. Records clips too, since browser noiseSuppression also
 * changes the audio a session would score.
 *
 * Nothing is saved: events and clips live in this component's state.
 */

interface Constraints {
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
}

/** What a live session asks for (app/page.tsx's ensureMicStream). */
const SESSION_CONSTRAINTS: Constraints = { noiseSuppression: false, echoCancellation: true, autoGainControl: false };

const CONSTRAINT_LABELS: Record<keyof Constraints, string> = {
  noiseSuppression: "Noise suppression",
  echoCancellation: "Echo cancellation",
  autoGainControl: "Auto gain control",
};

const ZONE_LABELS: Record<CefrZone, string> = {
  foundation: "Foundation (A1–A2): 2.5 s, no short-reply budget",
  core: "Core (B1–C1): 1.2 s short replies, 2.5 s otherwise",
  mastery: "Mastery (C2): 1.2 s short replies, 4 s otherwise",
};

/** Same cadence as the candidate mic check, so lib/noise-check.ts's window means the same ~5 s. */
const POLL_MS = 80;
/** Meter scale (dBFS). */
const METER_MIN_DB = -80;
const METER_MAX_DB = -10;

interface LabEvent {
  id: number;
  atMs: number;
  kind: "start" | "end" | "noise" | "dropped" | "capped";
  spokenMs?: number;
  /** Time between the last voiced frame and the turn closing — the "how long did it wait" number. */
  waitMs?: number;
  note?: string;
}

const EVENT_LABELS: Record<LabEvent["kind"], string> = {
  start: "Turn opened",
  end: "Turn closed",
  noise: "Noise ignored (Silero)",
  dropped: "Silero dropped",
  capped: "Turn capped (max length)",
};

type Mode = "volume" | "silero";

interface Clip {
  id: number;
  url: string;
  label: string;
  seconds: number;
}

function describe(c: Partial<Constraints>): string {
  return (Object.keys(CONSTRAINT_LABELS) as (keyof Constraints)[])
    .map((k) => `${CONSTRAINT_LABELS[k].split(" ")[0]} ${c[k] === undefined ? "?" : c[k] ? "on" : "off"}`)
    .join(" · ");
}

function meterPct(db: number): number {
  return Math.min(100, Math.max(0, ((db - METER_MIN_DB) / (METER_MAX_DB - METER_MIN_DB)) * 100));
}

function fmtTime(ms: number): string {
  const s = ms / 1000;
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
}

export function VadLab() {
  const [constraints, setConstraints] = useState<Constraints>(SESSION_CONSTRAINTS);
  const [zone, setZone] = useState<CefrZone>("core");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** What the browser actually applied — it may ignore a constraint (Safari, some Firefox builds). */
  const [applied, setApplied] = useState<Partial<Constraints> | null>(null);
  const [deviceLabel, setDeviceLabel] = useState<string | null>(null);
  const [levels, setLevels] = useState<{ rmsDb: number; thresholdDb: number; floorDb: number; isSpeaking: boolean; speechProb: number | null } | null>(null);
  const [mode, setMode] = useState<Mode>("volume");
  const [silero, setSilero] = useState<{ status: "idle" | "loading" | "ready" | "error"; loadMs?: number; meanInferenceMs?: number; error?: string }>({ status: "idle" });
  const [room, setRoom] = useState<RoomAssessment | null>(null);
  const [events, setEvents] = useState<LabEvent[]>([]);
  const [recording, setRecording] = useState(false);
  const [clips, setClips] = useState<Clip[]>([]);

  const streamRef = useRef<MediaStream | null>(null);
  const vadRef = useRef<TurnVad | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef(0);
  const speechStartRef = useRef(0);
  const nextIdRef = useRef(0);
  const readingsRef = useRef<number[]>([]);
  const recorderRef = useRef<{ mr: MediaRecorder; chunks: Blob[]; startedAt: number; label: string } | null>(null);
  const clipsRef = useRef<Clip[]>([]);
  clipsRef.current = clips;
  const sileroRef = useRef<SileroVad | null>(null);
  const modeRef = useRef<Mode>("volume");
  modeRef.current = mode;

  const addEvent = (e: Omit<LabEvent, "id" | "atMs">) =>
    setEvents((prev) => [{ ...e, id: nextIdRef.current++, atMs: Date.now() - startedAtRef.current }, ...prev].slice(0, 40));

  function stop() {
    if (recorderRef.current?.mr.state === "recording") recorderRef.current.mr.stop();
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
    vadRef.current?.stop();
    vadRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setRunning(false);
    setLevels(null);
  }

  async function start(c: Constraints = constraints) {
    stop();
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { ...c, channelCount: 1, sampleRate: 48000 },
        video: false,
      });
      streamRef.current = stream;
      const track = stream.getAudioTracks()[0];
      const s = track?.getSettings() ?? {};
      setApplied({ noiseSuppression: s.noiseSuppression, echoCancellation: s.echoCancellation, autoGainControl: s.autoGainControl });
      setDeviceLabel(track?.label || "Default microphone");

      startedAtRef.current = Date.now();
      readingsRef.current = [];
      setRoom(null);
      setEvents([]);
      const vad = new TurnVad(stream, {
        onSpeechStart: () => {
          speechStartRef.current = Date.now();
          addEvent({ kind: "start" });
        },
        onSpeechEnd: (spokenMs) => {
          addEvent({ kind: "end", spokenMs, waitMs: Date.now() - (speechStartRef.current + spokenMs) });
        },
        onNoiseIgnored: () => addEvent({ kind: "noise" }),
        onTurnCapped: (spokenMs) => addEvent({ kind: "capped", spokenMs }),
        onClassifierDropped: (reason) => {
          addEvent({ kind: "dropped", note: reason });
          setMode("volume");
        },
      });
      vad.setPauseZone(zone);
      if (modeRef.current === "silero" && sileroRef.current) vad.setClassifier(sileroRef.current);
      vadRef.current = vad;

      let ticks = 0;
      pollRef.current = setInterval(() => {
        const l = vadRef.current?.getLevels();
        if (!l) return;
        setLevels({ rmsDb: rmsToDb(l.rms), thresholdDb: rmsToDb(l.threshold), floorDb: rmsToDb(l.noiseFloor), isSpeaking: l.isSpeaking, speechProb: l.speechProb });
        if (++ticks % 25 === 0 && sileroRef.current) {
          const { meanInferenceMs } = sileroRef.current.stats();
          setSilero((prev) => ({ ...prev, meanInferenceMs }));
        }
        const r = readingsRef.current;
        r.push(l.rms);
        if (r.length > NOISE_CHECK_WINDOW) r.shift();
        setRoom(assessRoom(r));
      }, POLL_MS);
      setRunning(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      stop();
    }
  }

  /** Constraints only apply at getUserMedia time (applyConstraints support varies), so a change reopens the mic. */
  function toggleConstraint(k: keyof Constraints) {
    const next = { ...constraints, [k]: !constraints[k] };
    setConstraints(next);
    if (running) void start(next);
  }

  async function changeMode(m: Mode) {
    setMode(m);
    if (m === "volume") {
      vadRef.current?.setClassifier(null);
      return;
    }
    if (!sileroRef.current) {
      setSilero({ status: "loading" });
      const t0 = performance.now();
      try {
        sileroRef.current = await SileroVad.load();
        setSilero({ status: "ready", loadMs: performance.now() - t0 });
      } catch (e) {
        setSilero({ status: "error", error: e instanceof Error ? e.message : String(e) });
        setMode("volume");
        return;
      }
    }
    if (modeRef.current === "silero") vadRef.current?.setClassifier(sileroRef.current);
  }

  function changeZone(z: CefrZone) {
    setZone(z);
    vadRef.current?.setPauseZone(z);
  }

  function toggleRecording() {
    const current = recorderRef.current;
    if (current) {
      current.mr.stop();
      return;
    }
    const stream = streamRef.current;
    if (!stream) return;
    const mimeType = pickRecorderMimeType();
    const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const rec = { mr, chunks: [] as Blob[], startedAt: Date.now(), label: describe(applied ?? constraints) };
    mr.ondataavailable = (e) => { if (e.data.size > 0) rec.chunks.push(e.data); };
    mr.onstop = () => {
      recorderRef.current = null;
      setRecording(false);
      const blob = new Blob(rec.chunks, { type: mr.mimeType });
      if (blob.size === 0) return;
      setClips((prev) => [
        { id: nextIdRef.current++, url: URL.createObjectURL(blob), label: rec.label, seconds: (Date.now() - rec.startedAt) / 1000 },
        ...prev,
      ]);
    };
    recorderRef.current = rec;
    mr.start();
    setRecording(true);
  }

  useEffect(
    () => () => {
      stop();
      clipsRef.current.forEach((c) => URL.revokeObjectURL(c.url));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const sameAsSession = (Object.keys(SESSION_CONSTRAINTS) as (keyof Constraints)[]).every((k) => constraints[k] === SESSION_CONSTRAINTS[k]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 760 }}>
      <div className={styles.card}>
        <div style={{ fontWeight: 600, color: adminColors.ink, marginBottom: 10 }}>Microphone</div>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 10 }}>
          {(Object.keys(CONSTRAINT_LABELS) as (keyof Constraints)[]).map((k) => (
            <label key={k} className={styles.checkboxLabel}>
              <input type="checkbox" checked={constraints[k]} onChange={() => toggleConstraint(k)} />
              {CONSTRAINT_LABELS[k]}
            </label>
          ))}
        </div>
        <div style={{ fontSize: 12, color: sameAsSession ? adminColors.muted : adminColors.warning, marginBottom: 12 }}>
          {sameAsSession
            ? "Same settings as a live session."
            : "Differs from a live session (noise suppression off, echo cancellation on, auto gain off). Browser processing also changes the recorded audio used for pronunciation scoring: record a clip and listen."}
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button className={styles.runButton} onClick={() => (running ? stop() : void start())}>
            {running ? "Stop" : "Start mic"}
          </button>
          {running && (
            <button className={styles.runButton} onClick={toggleRecording} style={recording ? { background: adminColors.danger } : undefined}>
              {recording ? "Stop recording" : "Record a clip"}
            </button>
          )}
          {deviceLabel && running && <span style={{ fontSize: 12, color: adminColors.muted }}>{deviceLabel}</span>}
        </div>
        {applied && running && (
          <div style={{ fontSize: 12, color: adminColors.muted, marginTop: 8 }}>Applied by the browser: {describe(applied)}</div>
        )}
        {error && <div className={styles.errorBox} style={{ marginTop: 10 }}>{error}</div>}
      </div>

      <div className={styles.card}>
        <div style={{ fontWeight: 600, color: adminColors.ink, marginBottom: 10 }}>Turn detection</div>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 10 }}>
          <label className={styles.checkboxLabel}>
            <input type="radio" checked={mode === "volume"} onChange={() => void changeMode("volume")} /> Volume threshold (live default)
          </label>
          <label className={styles.checkboxLabel}>
            <input type="radio" checked={mode === "silero"} disabled={silero.status === "loading"} onChange={() => void changeMode("silero")} /> Silero + volume
          </label>
        </div>
        {silero.status !== "idle" && (
          <div style={{ fontSize: 12, color: silero.status === "error" ? adminColors.danger : adminColors.muted, marginBottom: 10 }}>
            {silero.status === "loading" && "Loading Silero…"}
            {silero.status === "error" && `Silero failed to load: ${silero.error}`}
            {silero.status === "ready" && (
              <>
                Silero loaded in {((silero.loadMs ?? 0) / 1000).toFixed(1)} s
                {silero.meanInferenceMs ? ` · ${silero.meanInferenceMs.toFixed(1)} ms per 32 ms window` : ""}
              </>
            )}
          </div>
        )}
        <label style={{ fontSize: 13, color: adminColors.text, display: "flex", gap: 8, alignItems: "center", marginBottom: 14 }}>
          Silence budget
          <select value={zone} onChange={(e) => changeZone(e.target.value as CefrZone)} className={styles.filterInput} style={{ width: "auto" }}>
            {(Object.keys(ZONE_LABELS) as CefrZone[]).map((z) => (
              <option key={z} value={z}>{ZONE_LABELS[z]}</option>
            ))}
          </select>
        </label>

        <div style={{ position: "relative", height: 22, background: adminColors.panel, borderRadius: 4, overflow: "hidden" }}>
          <div
            style={{
              position: "absolute", inset: 0, width: `${levels ? meterPct(levels.rmsDb) : 0}%`,
              background: levels?.isSpeaking ? adminColors.success : adminColors.borderStrong, transition: "width 60ms linear",
            }}
          />
          {levels && (
            <div title="Speech threshold" style={{ position: "absolute", top: 0, bottom: 0, left: `${meterPct(levels.thresholdDb)}%`, width: 2, background: adminColors.danger }} />
          )}
        </div>
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap", fontSize: 12, color: adminColors.muted, marginTop: 6 }}>
          <span>Level {levels ? `${levels.rmsDb.toFixed(0)} dB` : "–"}</span>
          <span style={{ color: adminColors.danger }}>Threshold {levels ? `${levels.thresholdDb.toFixed(0)} dB` : "–"}</span>
          <span>Learned noise floor {levels ? `${levels.floorDb.toFixed(0)} dB` : "–"}</span>
          {mode === "silero" && (
            <span>Speech probability {levels?.speechProb != null ? `${Math.round(levels.speechProb * 100)} %` : "–"}</span>
          )}
          <span style={{ fontWeight: 600, color: levels?.isSpeaking ? adminColors.success : adminColors.muted }}>
            {levels ? (levels.isSpeaking ? "In a turn" : "Waiting") : ""}
          </span>
        </div>
        <div style={{ fontSize: 12, color: adminColors.muted, marginTop: 4 }}>
          {mode === "silero"
            ? "Voice = Silero hears speech (≥ 50 %) and the level is above half the red line. Loud sounds that aren't speech are ignored."
            : "Anything above the red line counts as voice: it opens a turn, or restarts the silence wait."}
        </div>
      </div>

      <div className={styles.card}>
        <div style={{ fontWeight: 600, color: adminColors.ink, marginBottom: 4 }}>Events</div>
        <div style={{ fontSize: 12, color: adminColors.muted, marginBottom: 10 }}>
          “Wait” is how long the turn stayed open after the last sound counted as voice. It should match the silence budget; a noise after your last word adds to it.
        </div>
        {events.length === 0 ? (
          <div style={{ fontSize: 13, color: adminColors.faint }}>{running ? "Say something…" : "Start the mic to see turns."}</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr><th>Time</th><th>Event</th><th>Spoken</th><th>Wait</th></tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td>{fmtTime(e.atMs)}</td>
                  <td>{EVENT_LABELS[e.kind]}{e.note ? ` — ${e.note}` : ""}</td>
                  <td>{e.spokenMs !== undefined ? `${(e.spokenMs / 1000).toFixed(1)} s` : ""}</td>
                  <td>{e.waitMs !== undefined ? `${(e.waitMs / 1000).toFixed(1)} s` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className={styles.card}>
        <div style={{ fontWeight: 600, color: adminColors.ink, marginBottom: 4 }}>Room check</div>
        <div style={{ fontSize: 13, color: adminColors.text }}>
          {!room || room.verdict === "unknown"
            ? running ? "Measuring…" : "–"
            : <>
                <strong>{room.verdict}</strong> · background {room.floorDb?.toFixed(0)} dB
                {room.voiceDb !== null && <> · voice {room.voiceDb.toFixed(0)} dB · gap {room.snrDb?.toFixed(0)} dB</>}
              </>}
        </div>
        <div style={{ fontSize: 12, color: adminColors.muted, marginTop: 4 }}>
          The same assessment as the candidate mic check, on the last ~5 s.
        </div>
      </div>

      {clips.length > 0 && (
        <div className={styles.card}>
          <div style={{ fontWeight: 600, color: adminColors.ink, marginBottom: 10 }}>Clips</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {clips.map((c) => (
              <div key={c.id} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 12, color: adminColors.muted }}>{c.label} · {c.seconds.toFixed(1)} s</span>
                <audio controls src={c.url} style={{ width: "100%" }} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
