"use client";

import { useRef, useState } from "react";
import { CEFR_LADDER, type CefrRung } from "@/lib/cefr-rung";
import { DOMAIN_LABEL, type TopicDomain } from "@/lib/topic-domain";
import type { SimEvent, SimPersona, SimConfig } from "@/lib/conversation-sim";
import type { CefrResult } from "@/lib/types";
import type { CompositeCefrScore } from "@/lib/cefr-score";
import { CefrPanel } from "@/components/ScoreDisplay";
import { adminColors } from "@/lib/admin-theme";
import styles from "@/components/admin.module.css";

const LANGUAGES: { value: string; label: string }[] = [
  { value: "fr", label: "Français" },
  { value: "en", label: "English" },
  { value: "nl-BE", label: "Nederlands (BE)" },
  { value: "es", label: "Español" },
  { value: "it", label: "Italiano" },
  { value: "de", label: "Deutsch" },
];

const selectStyle: React.CSSProperties = {
  padding: "6px 8px",
  borderRadius: 4,
  border: `1px solid ${adminColors.border}`,
  background: adminColors.bg,
  color: adminColors.ink,
  fontSize: 13,
};

const labelStyle: React.CSSProperties = { fontSize: 13, color: adminColors.muted, display: "flex", alignItems: "center", gap: 6 };

const chipStyle: React.CSSProperties = {
  display: "inline-block",
  fontSize: 11,
  padding: "1px 7px",
  borderRadius: 10,
  marginRight: 6,
  marginTop: 6,
  background: adminColors.hairline,
  color: adminColors.muted,
};

const VERDICT_COLOR: Record<string, string> = {
  well: adminColors.success,
  adequate: adminColors.warning,
  struggled: adminColors.danger,
};

type Entry =
  | {
      kind: "examiner";
      turn: number;
      text: string;
      rung: CefrRung;
      closing: boolean;
      avoidDomain?: TopicDomain;
      switchToDomain?: TopicDomain;
      topic?: { domain: TopicDomain | null; streak: number };
    }
  | { kind: "learner"; turn: number; text: string; et?: { verdict: string; previousRung: CefrRung; nextRung: CefrRung } };

interface RunState {
  config?: SimConfig;
  persona?: SimPersona;
  learnerModel?: string;
  examinerModel?: string;
  entries: Entry[];
  evaluation?: { result: CefrResult; composite: CompositeCefrScore };
  errors: string[];
  durationMs?: number;
}

/**
 * Admin conversation simulator — picks a language + learner CEFR level, runs
 * one simulated session through POST /api/simulations (lib/conversation-sim.ts),
 * and renders the transcript live with each turn's ET/TT signals, then the
 * text-only CEFR evaluation.
 */
export function ConversationSimulator() {
  const [language, setLanguage] = useState("fr");
  const [learnerLevel, setLearnerLevel] = useState<CefrRung>("B1");
  const [startingRung, setStartingRung] = useState<"" | CefrRung>("");
  const [answers, setAnswers] = useState(8);
  const [learnerProvider, setLearnerProvider] = useState<"anthropic" | "mistral">("mistral");
  const [running, setRunning] = useState(false);
  const [run, setRun] = useState<RunState | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const apply = (state: RunState, e: SimEvent): RunState => {
    switch (e.type) {
      case "start":
        return { ...state, config: e.config, persona: e.persona, learnerModel: e.learnerModel, examinerModel: e.examinerModel };
      case "examiner":
        return { ...state, entries: [...state.entries, { kind: "examiner", ...e }] };
      case "learner":
        return { ...state, entries: [...state.entries, { kind: "learner", turn: e.turn, text: e.text }] };
      case "topic":
        return {
          ...state,
          entries: state.entries.map((x) =>
            x.kind === "examiner" && x.turn === e.turn ? { ...x, topic: { domain: e.domain, streak: e.streak } } : x,
          ),
        };
      case "et":
        return {
          ...state,
          entries: state.entries.map((x) =>
            x.kind === "learner" && x.turn === e.turn
              ? { ...x, et: { verdict: e.verdict, previousRung: e.previousRung, nextRung: e.nextRung } }
              : x,
          ),
        };
      case "evaluation":
        return { ...state, evaluation: { result: e.result, composite: e.composite } };
      case "error":
        return { ...state, errors: [...state.errors, `${e.stage}: ${e.message}`] };
      case "done":
        return { ...state, durationMs: e.durationMs };
    }
  };

  const start = async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    let state: RunState = { entries: [], errors: [] };
    setRun(state);
    try {
      const res = await fetch("/api/simulations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language, learnerLevel, startingRung: startingRung || undefined, answers, learnerProvider }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          state = apply(state, JSON.parse(line) as SimEvent);
          setRun(state);
        }
      }
    } catch (e) {
      if (!controller.signal.aborted) setRun({ ...state, errors: [...state.errors, String(e)] });
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  const stop = () => abortRef.current?.abort();

  return (
    <div>
      <div className={styles.card}>
        <div className={styles.evalLabControls} style={{ marginBottom: 0 }}>
          <label style={labelStyle}>
            Language
            <select style={selectStyle} value={language} onChange={(e) => setLanguage(e.target.value)} disabled={running}>
              {LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </select>
          </label>
          <label style={labelStyle}>
            Learner level
            <select style={selectStyle} value={learnerLevel} onChange={(e) => setLearnerLevel(e.target.value as CefrRung)} disabled={running}>
              {CEFR_LADDER.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </label>
          <label style={labelStyle}>
            Starting rung
            <select style={selectStyle} value={startingRung} onChange={(e) => setStartingRung(e.target.value as "" | CefrRung)} disabled={running}>
              <option value="">Admin setting</option>
              {CEFR_LADDER.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </label>
          <label style={labelStyle}>
            Learner model
            <select
              style={selectStyle}
              value={learnerProvider}
              onChange={(e) => setLearnerProvider(e.target.value as "anthropic" | "mistral")}
              disabled={running}
            >
              <option value="mistral">Mistral</option>
              <option value="anthropic">Claude</option>
            </select>
          </label>
          <label style={labelStyle}>
            Answers
            <input
              type="number"
              min={1}
              max={15}
              value={answers}
              onChange={(e) => setAnswers(Math.max(1, Math.min(15, Number(e.target.value) || 1)))}
              style={{ ...selectStyle, width: 56 }}
              disabled={running}
            />
          </label>
          {running ? (
            <button className={styles.runButton} onClick={stop}>Stop</button>
          ) : (
            <button className={styles.runButton} onClick={start}>Run simulation</button>
          )}
        </div>
      </div>

      {run && (
        <>
          {run.persona && run.config && (
            <div style={{ fontSize: 13, color: adminColors.muted, margin: "0 0 16px", lineHeight: 1.6 }}>
              Learner: <strong style={{ color: adminColors.ink }}>{run.persona.name}</strong>, {run.persona.age},{" "}
              {run.persona.job}, {run.persona.city} · native {run.persona.nativeLanguage} · playing{" "}
              <strong style={{ color: adminColors.ink }}>{run.config.learnerLevel}</strong>
              <br />
              Starting rung {run.config.startingRung} · step size {run.config.stepSize} · learner model{" "}
              {run.learnerModel} · examiner model {run.examinerModel}
              {run.durationMs !== undefined && <> · took {Math.round(run.durationMs / 1000)}s</>}
            </div>
          )}

          {run.errors.map((err, i) => (
            <div key={i} className={styles.errorBox}>{err}</div>
          ))}

          {run.evaluation && run.config && (
            <div className={styles.card} style={{ fontSize: 14 }}>
              Target level <strong>{run.config.learnerLevel}</strong> → assessed{" "}
              <strong>{run.evaluation.composite.level}</strong> ({run.evaluation.composite.score}/100) · final ET rung{" "}
              <strong>{lastRung(run.entries) ?? "—"}</strong>
              <div style={{ fontSize: 12, color: adminColors.faint, marginTop: 4 }}>
                Text-only evaluation: no pronunciation or speaking rate, so fluency is judged from the transcript alone.
              </div>
            </div>
          )}

          {run.evaluation && (
            <div className={styles.scoreCardWrap}>
              <CefrPanel result={run.evaluation.result} pronunciationAvg={null} sourceLabel="Simulation" showAllDetails theme="light" />
            </div>
          )}

          <div className={styles.turnList} style={{ marginTop: 16 }}>
            {run.entries.map((entry) => (
              <div
                key={`${entry.kind}-${entry.turn}`}
                className={`${styles.turnCard} ${entry.kind === "learner" ? styles.turnCardUser : styles.turnCardAssistant}`}
              >
                <div className={styles.turnMeta}>
                  {entry.kind === "examiner" ? (entry.closing ? "examiner · closing" : `examiner · turn ${entry.turn + 1}`) : `learner · answer ${entry.turn}`}
                </div>
                <div className={styles.turnText} style={{ whiteSpace: "pre-wrap" }}>{entry.text}</div>
                {entry.kind === "examiner" && (
                  <div>
                    <span style={chipStyle}>rung {entry.rung}</span>
                    {entry.topic && (
                      <span style={chipStyle}>
                        topic {entry.topic.domain ? DOMAIN_LABEL[entry.topic.domain] : "?"} · streak {entry.topic.streak}
                      </span>
                    )}
                    {entry.switchToDomain && (
                      <span style={{ ...chipStyle, background: adminColors.accentTint, color: adminColors.accentInk }}>
                        forced switch → {DOMAIN_LABEL[entry.switchToDomain]}
                      </span>
                    )}
                  </div>
                )}
                {entry.kind === "learner" && entry.et && (
                  <div>
                    <span style={{ ...chipStyle, color: VERDICT_COLOR[entry.et.verdict] ?? adminColors.muted }}>
                      ET {entry.et.verdict} · {entry.et.previousRung} → {entry.et.nextRung}
                    </span>
                  </div>
                )}
              </div>
            ))}
            {running && <div style={{ fontSize: 13, color: adminColors.faint }}>Running…</div>}
          </div>
        </>
      )}
    </div>
  );
}

function lastRung(entries: Entry[]): CefrRung | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.kind === "learner" && e.et) return e.et.nextRung;
  }
  return null;
}
