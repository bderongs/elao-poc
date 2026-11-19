"use client";

/**
 * Written test (MVP): three free productions of 50 to 100 words, evaluated by
 * POST /api/writing/evaluate (lib/writing). Independent of the speaking test
 * (app/page.tsx) — it shares only the candidate screens' look and the
 * evaluating screen. Nothing is saved server-side: drafts and the result live
 * in sessionStorage so a reload loses nothing.
 */
import { useCallback, useEffect, useState } from "react";
import { CandidateTopBar } from "@/components/CandidateTopBar";
import { EvaluatingScreen } from "@/components/EvaluatingScreen";
import { WritingResultsScreen } from "@/components/writing/WritingResultsScreen";
import styles from "@/components/candidate.module.css";
import { UiLangProvider, useUi, useUiLangFromBrowser } from "@/lib/ui-lang";
import { WORD_LIMITS } from "@/lib/writing/grid";
import { WRITING_TASKS, countWords } from "@/lib/writing/tasks";
import { WRITING_LANGS, isWritingLang, type WritingLang, type WritingResult } from "@/lib/writing/types";
import { writingStrings, type WritingStrings } from "@/lib/writing/ui-strings";

type Step = { kind: "intro" } | { kind: "task"; index: number } | { kind: "evaluating" } | { kind: "done" };

const DRAFT_KEY = "elao-writing-draft";
const RESULT_KEY = "elao-writing-result";

interface Draft {
  language: WritingLang;
  texts: string[];
  index: number;
}

function readStorage<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: unknown) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable: the test still works, a reload just starts over
  }
}

export default function WritingTestPage() {
  const [uiLang, setUiLang] = useUiLangFromBrowser();
  return (
    <UiLangProvider lang={uiLang} setLang={setUiLang}>
      <WritingTest />
    </UiLangProvider>
  );
}

function WritingTest() {
  const { lang: uiLang } = useUi();
  const t = writingStrings(uiLang);
  const [step, setStep] = useState<Step>({ kind: "intro" });
  const [language, setLanguage] = useState<WritingLang>("fr");
  const [texts, setTexts] = useState<string[]>(["", "", ""]);
  const [result, setResult] = useState<WritingResult | null>(null);
  const [evalDone, setEvalDone] = useState(false);
  const [evalError, setEvalError] = useState<"failed" | "rate_limited" | null>(null);

  // Restore after a reload: a finished result first, else the draft in progress.
  useEffect(() => {
    const saved = readStorage<WritingResult>(RESULT_KEY);
    if (saved) {
      setResult(saved);
      setLanguage(saved.language);
      setTexts(saved.texts);
      setStep({ kind: "done" });
      return;
    }
    const draft = readStorage<Draft>(DRAFT_KEY);
    if (draft && isWritingLang(draft.language) && Array.isArray(draft.texts)) {
      setLanguage(draft.language);
      setTexts(draft.texts);
      setStep({ kind: "task", index: Math.min(Math.max(0, draft.index), WRITING_TASKS[draft.language].length - 1) });
    } else if (isWritingLang(new URLSearchParams(window.location.search).get("lang"))) {
      setLanguage(new URLSearchParams(window.location.search).get("lang") as WritingLang);
    }
  }, []);

  useEffect(() => {
    if (step.kind === "task") writeStorage(DRAFT_KEY, { language, texts, index: step.index } satisfies Draft);
  }, [step, language, texts]);

  const evaluate = useCallback(async () => {
    setEvalDone(false);
    setEvalError(null);
    setStep({ kind: "evaluating" });
    try {
      const res = await fetch("/api/writing/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language, uiLang, texts }),
      });
      if (res.status === 429) throw new Error("rate_limited");
      if (!res.ok) throw new Error("failed");
      const { result: r } = (await res.json()) as { result: WritingResult };
      setResult(r);
      writeStorage(RESULT_KEY, r);
      writeStorage(DRAFT_KEY, null);
    } catch (e) {
      setEvalError(e instanceof Error && e.message === "rate_limited" ? "rate_limited" : "failed");
    } finally {
      setEvalDone(true);
    }
  }, [language, uiLang, texts]);

  const restart = () => {
    writeStorage(RESULT_KEY, null);
    writeStorage(DRAFT_KEY, null);
    setResult(null);
    setTexts(["", "", ""]);
    setEvalError(null);
    setStep({ kind: "intro" });
  };

  return (
    <main style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", background: "#F7F5F0", color: "#141D33", fontFamily: "'DM Sans',system-ui,sans-serif" }}>
      <style>{`
        .elao-btn-primary { transition: background 0.15s; }
        .elao-btn-primary:hover { background:#243052 !important; }
        .elao-lang-card:hover { border-color:#141D33 !important; }
        .elao-text-action:hover { color:#141D33 !important; }
        .elao-writing-area:focus { outline:none; border-color:#141D33 !important; }
      `}</style>

      {step.kind === "intro" && (
        <IntroScreen t={t} language={language} onLanguage={setLanguage} onStart={() => setStep({ kind: "task", index: 0 })} />
      )}

      {step.kind === "task" && (
        <TaskScreen
          key={step.index}
          t={t}
          language={language}
          index={step.index}
          text={texts[step.index] ?? ""}
          onText={(v) => setTexts((prev) => prev.map((x, i) => (i === step.index ? v : x)))}
          onBack={() => (step.index === 0 ? setStep({ kind: "intro" }) : setStep({ kind: "task", index: step.index - 1 }))}
          onNext={() => (step.index === WRITING_TASKS[language].length - 1 ? evaluate() : setStep({ kind: "task", index: step.index + 1 }))}
        />
      )}

      {step.kind === "evaluating" && (
        <EvaluatingScreen
          done={evalDone}
          onDone={() => setStep({ kind: "done" })}
          labels={t.evaluating.labels}
          title={t.evaluating.title}
          lead={t.evaluating.lead}
          footnote={t.mvpNotice}
          expectedSeconds={45}
        />
      )}

      {step.kind === "done" && (
        <WritingResultsScreen
          t={t}
          uiLang={uiLang}
          result={result}
          error={evalError}
          onRetry={evaluate}
          onEdit={() => setStep({ kind: "task", index: WRITING_TASKS[language].length - 1 })}
          onRestart={restart}
        />
      )}
    </main>
  );
}

// ─── intro ────────────────────────────────────────────────────────────────

function IntroScreen({ t, language, onLanguage, onStart }: { t: WritingStrings; language: WritingLang; onLanguage: (l: WritingLang) => void; onStart: () => void }) {
  return (
    <>
      <CandidateTopBar />
      <div className={styles.welcomeScreen}>
        <div style={{ textAlign: "center", maxWidth: 640, display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
          <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: "#8A8F9C", letterSpacing: "0.12em", textTransform: "uppercase" }}>{t.intro.eyebrow}</span>
          <h1 className={styles.titleXL} style={{ margin: 0, fontFamily: "'Outfit',sans-serif", fontWeight: 400, color: "#141D33", letterSpacing: "-0.02em", lineHeight: 1.15 }}>
            {t.intro.titleLine1}
            <br className={styles.hideMobile} /> {t.intro.titleLine2}
          </h1>
          <p className={styles.lead} style={{ margin: 0, color: "#5A5F6E", lineHeight: 1.55, maxWidth: 540 }}>
            {t.intro.lead}
          </p>
        </div>

        <div className={styles.welcomeSteps}>
          {t.intro.steps.map(([title, desc], i) => (
            <div key={title} className={styles.welcomeStep}>
              <StepBadge n={i + 1} />
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontFamily: "'Outfit',sans-serif", fontSize: 18, color: "#141D33" }}>{title}</span>
                <span style={{ fontSize: 15, color: "#6B6F7D", lineHeight: 1.5 }}>{desc}</span>
              </div>
            </div>
          ))}
        </div>

        <div className={styles.welcomeCta}>
          <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: "#8A8F9C", letterSpacing: "0.12em" }}>{t.intro.languageLabel}</span>
          <div role="radiogroup" style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
            {WRITING_LANGS.map((l) => {
              const selected = l === language;
              return (
                <button
                  key={l}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className="elao-lang-card"
                  onClick={() => onLanguage(l)}
                  style={{
                    minWidth: 150,
                    padding: "14px 22px",
                    borderRadius: 12,
                    background: selected ? "#FFFFFF" : "transparent",
                    border: `1.5px solid ${selected ? "#141D33" : "#E4E0D7"}`,
                    fontFamily: "'Outfit',sans-serif",
                    fontSize: 17,
                    color: "#141D33",
                    cursor: "pointer",
                  }}
                >
                  {t.langName[l]}
                </button>
              );
            })}
          </div>
          <button className={`elao-btn-primary ${styles.fullWidthMobile}`} onClick={onStart} style={{ ...primaryBtn(), marginTop: 8 }}>
            {t.intro.start}
          </button>
          <span style={{ fontSize: 13, color: "#8A8F9C", textAlign: "center", maxWidth: 420 }}>{t.intro.rules}</span>
          <span style={{ fontSize: 12, color: "#8A8F9C", textAlign: "center" }}>{t.mvpNotice}</span>
        </div>
      </div>
    </>
  );
}

// ─── one task ─────────────────────────────────────────────────────────────

function TaskScreen({
  t,
  language,
  index,
  text,
  onText,
  onBack,
  onNext,
}: {
  t: WritingStrings;
  language: WritingLang;
  index: number;
  text: string;
  onText: (v: string) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const tasks = WRITING_TASKS[language];
  const task = tasks[index];
  const isLast = index === tasks.length - 1;
  const words = countWords(text);
  const [notice, setNotice] = useState<string | null>(null);

  const status = words < WORD_LIMITS.min ? "short" : words > WORD_LIMITS.max ? "long" : words > WORD_LIMITS.target ? "over" : "ok";
  const counterColor = status === "ok" ? "#2f9e6e" : status === "long" ? "#b3261e" : status === "over" ? "#8A6410" : "#8A8F9C";

  const next = () => {
    // Never disabled: the click says what is missing (doc/new_design convention).
    if (status === "short") return setNotice(t.task.tooShort(words));
    if (status === "long") return setNotice(t.task.tooLong);
    setNotice(null);
    onNext();
  };

  const blockPaste = (e: React.ClipboardEvent | React.DragEvent) => {
    e.preventDefault();
    setNotice(t.task.pasteBlocked);
  };

  return (
    <>
      <CandidateTopBar
        right={
          <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, color: "#6B6F7D", letterSpacing: "0.08em" }}>
            {t.task.counter(index + 1, tasks.length).toUpperCase()}
          </span>
        }
      />
      <div style={{ flex: 1, display: "flex", justifyContent: "center", padding: "8px 16px 48px" }}>
        <div style={{ width: "100%", maxWidth: 720, display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ display: "flex", gap: 6 }} aria-hidden>
            {tasks.map((x, i) => (
              <div key={x.id} style={{ flex: 1, height: 4, borderRadius: 2, background: i <= index ? "#141D33" : "#E4E0D7" }} />
            ))}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <h1 className={styles.titleM} style={{ margin: 0, fontFamily: "'Outfit',sans-serif", fontWeight: 400, letterSpacing: "-0.02em" }}>
              {task.title}
            </h1>
            <div style={{ padding: "16px 18px", borderRadius: 14, background: "#FFFFFF", border: "1px solid #E4E0D7" }}>
              <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: "#8A8F9C", letterSpacing: "0.1em", marginBottom: 8 }}>{t.task.instructionsLabel}</div>
              <p lang={language} style={{ margin: 0, fontSize: 17, lineHeight: 1.55, color: "#141D33" }}>
                {task.instructions}
              </p>
            </div>
          </div>

          <textarea
            className="elao-writing-area"
            lang={language}
            value={text}
            onChange={(e) => {
              onText(e.target.value);
              if (notice) setNotice(null);
            }}
            onPaste={blockPaste}
            onDrop={blockPaste}
            placeholder={t.task.placeholder}
            aria-label={task.title}
            // The texts are judged on spelling: no browser help.
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            autoComplete="off"
            data-gramm="false"
            data-gramm_editor="false"
            data-enable-grammarly="false"
            rows={10}
            style={{
              width: "100%",
              boxSizing: "border-box",
              minHeight: 240,
              resize: "vertical",
              padding: "16px 18px",
              borderRadius: 14,
              border: "1.5px solid #E4E0D7",
              background: "#FFFFFF",
              color: "#141D33",
              fontFamily: "'DM Sans',system-ui,sans-serif",
              fontSize: 17,
              lineHeight: 1.6,
            }}
          />

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginTop: -8 }}>
            <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 13, color: counterColor }}>
              {t.task.words(words)} · {t.task.range}
            </span>
            {status === "over" && <span style={{ fontSize: 13, color: "#8A6410" }}>{t.task.overTarget}</span>}
          </div>

          {notice && (
            <div role="status" style={{ padding: "12px 16px", borderRadius: 12, background: "#FDF0D0", border: "1px solid #F0DDA8", color: "#8A6410", fontSize: 14 }}>
              {notice}
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap-reverse" }}>
            <span
              onClick={onBack}
              className={`elao-text-action ${styles.tapTarget}`}
              style={{ fontSize: 14, color: "#6B6F7D", borderBottom: "1px solid #C9C4B8", paddingBottom: 2, cursor: "pointer" }}
            >
              {index === 0 ? t.task.home : t.task.back}
            </span>
            <button className={`elao-btn-primary ${styles.fullWidthMobile}`} onClick={next} style={primaryBtn("14px 32px")}>
              {isLast ? t.task.finish : t.task.next}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── shared bits (same look as app/page.tsx) ──────────────────────────────

function StepBadge({ n }: { n: number }) {
  return (
    <div
      style={{
        width: 28,
        height: 28,
        borderRadius: "50%",
        background: "#FDF0D0",
        color: "#8A6410",
        fontFamily: "'Outfit',sans-serif",
        fontSize: 15,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "none",
      }}
    >
      {n}
    </div>
  );
}

function primaryBtn(padding: string = "16px 40px"): React.CSSProperties {
  return {
    padding,
    borderRadius: 10,
    background: "#141D33",
    color: "#FFFFFF",
    fontFamily: "'Outfit',sans-serif",
    fontSize: 18,
    fontWeight: 500,
    border: "none",
    cursor: "pointer",
  };
}
