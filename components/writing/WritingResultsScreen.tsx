"use client";

import { CandidateTopBar } from "@/components/CandidateTopBar";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import styles from "@/components/candidate.module.css";
import type { UiLang } from "@/lib/ui-strings";
import { GRID } from "@/lib/writing/grid";
import { countsId, departureCounts } from "@/lib/writing/facts";
import { WRITING_TASKS } from "@/lib/writing/tasks";
import { BANDS, CRITERIA, FACT_CATEGORIES, bandValue, type CriterionBand, type WritingResult } from "@/lib/writing/types";
import type { WritingStrings } from "@/lib/writing/ui-strings";

const MONO: React.CSSProperties = { fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: "#8A8F9C", letterSpacing: "0.1em" };
const CARD: React.CSSProperties = { padding: "18px 20px", borderRadius: 14, background: "#FFFFFF", border: "1px solid #E4E0D7" };
const AMBER = "#8A6410";

/**
 * Results of the written test (/ecrit): the level, one band per criterion
 * with the excerpts it rests on, the caps applied, and the full survey
 * behind a collapsed section. Same "Salle claire" look as
 * SessionResultsScreen; its own component because the speaking result's
 * panel is built around the speaking axes and a saved session.
 */
export function WritingResultsScreen({
  t,
  uiLang,
  result,
  error,
  onRetry,
  onEdit,
  onRestart,
}: {
  t: WritingStrings;
  uiLang: UiLang;
  result: WritingResult | null;
  error: "failed" | "rate_limited" | null;
  onRetry: () => void;
  onEdit: () => void;
  onRestart: () => void;
}) {
  const r = t.results;
  const labelLang = uiLang === "fr" ? "fr" : "en";

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "auto", background: "#F7F5F0" }}>
      <CandidateTopBar
        right={
          <span onClick={onRestart} className={`elao-text-action ${styles.tapTarget}`} style={{ fontSize: 14, color: "#6B6F7D", borderBottom: "1px solid #C9C4B8", paddingBottom: 2, cursor: "pointer" }}>
            {r.newTest}
          </span>
        }
      />

      <div className={styles.resultsBody} style={{ maxWidth: 680 }}>
        <div style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: 8, marginBottom: 4 }}>
          <h2 className={styles.titleM} style={{ margin: 0, fontFamily: "'Outfit',sans-serif", fontWeight: 400, color: "#141D33", letterSpacing: "-0.02em" }}>
            {r.thanks}
          </h2>
          {result && <p style={{ margin: 0, fontSize: 16, color: "#5A5F6E" }}>{r.hereIsResult}</p>}
        </div>

        {!result && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14, alignItems: "center" }}>
            <div role="alert" style={{ padding: 16, borderRadius: 12, background: "#FDF0D0", border: "1px solid #F0DDA8", color: AMBER, fontSize: 14, width: "100%", boxSizing: "border-box" }}>
              {error === "rate_limited" ? r.rateLimited : r.evalFailed}
            </div>
            <button className="elao-btn-primary" onClick={onRetry} style={{ padding: "14px 32px", borderRadius: 10, background: "#141D33", color: "#FFFFFF", fontFamily: "'Outfit',sans-serif", fontSize: 17, fontWeight: 500, border: "none", cursor: "pointer" }}>
              {r.retry}
            </button>
            <span onClick={onEdit} className={`elao-text-action ${styles.tapTarget}`} style={{ fontSize: 14, color: "#6B6F7D", borderBottom: "1px solid #C9C4B8", paddingBottom: 2, cursor: "pointer" }}>
              {r.editTexts}
            </span>
          </div>
        )}

        {result && (
          <>
            <LevelCard t={t} result={result} />
            <div style={{ ...CARD, display: "flex", flexDirection: "column", gap: 22 }}>
              <div style={MONO}>{r.criteriaLabel}</div>
              {CRITERIA.map((c) => (
                <CriterionRow key={c} t={t} label={GRID[c].label[labelLang]} band={result.criteria[c]} result={result} />
              ))}
            </div>

            {result.caps.length > 0 && (
              <div style={{ ...CARD, display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={MONO}>{r.capsLabel}</div>
                {result.caps.map((cap) => (
                  <div key={cap.rule} style={{ fontSize: 14, color: "#5A5F6E", lineHeight: 1.5 }}>
                    <strong style={{ color: "#141D33", fontWeight: 500 }}>{r.cap[cap.rule]}</strong> → {cap.cap}
                    <div style={{ fontSize: 12, color: "#8A8F9C" }}>{cap.detail}</div>
                  </div>
                ))}
              </div>
            )}

            <CollapsibleSection title={r.detailToggle} defaultOpen={false} light>
              <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingTop: 14 }}>
                {result.surveys.map((_, i) => (
                  <SurveyCard key={i} t={t} result={result} index={i} />
                ))}
                <div style={{ fontSize: 12, color: "#8A8F9C", textAlign: "center" }}>
                  {r.meta(result.meta.model, `${result.meta.promptVersion} · ${result.meta.gridVersion}`, Math.round(result.meta.durationMs / 1000))}
                </div>
              </div>
            </CollapsibleSection>
          </>
        )}

        <div style={{ fontSize: 12, color: "#8A8F9C", textAlign: "center" }}>{t.mvpNotice}</div>
      </div>
    </div>
  );
}

function LevelCard({ t, result }: { t: WritingStrings; result: WritingResult }) {
  return (
    <div style={{ ...CARD, display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap" }}>
      <div style={{ fontFamily: "'Outfit',sans-serif", fontSize: 64, fontWeight: 400, lineHeight: 1, color: "#141D33", letterSpacing: "-0.03em" }}>{result.level}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, minWidth: 180 }}>
        <div style={MONO}>
          {t.results.levelLabel} · {t.langName[result.language].toUpperCase()}
        </div>
        <BandSegments value={bandValue(result.level)} />
        {result.caps.length > 0 && <div style={{ fontSize: 13, color: "#8A8F9C" }}>{t.results.beforeCaps(result.uncappedLevel)}</div>}
      </div>
    </div>
  );
}

function BandSegments({ value }: { value: number }) {
  return (
    <div style={{ display: "flex", gap: 4 }} aria-hidden>
      {BANDS.map((b, i) => (
        <div key={b} style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
          <div style={{ height: 5, borderRadius: 3, background: i < value ? "#141D33" : "#E4E0D7" }} />
          <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, color: i === value - 1 ? "#141D33" : "#B5B1A8", textAlign: "center" }}>{b}</span>
        </div>
      ))}
    </div>
  );
}

/** What a survey id points to, for display next to a band. */
function evidenceItem(t: WritingStrings, result: WritingResult, id: string): { text: string; quote: boolean; departure: boolean } | null {
  for (const [i, s] of result.surveys.entries()) {
    if (id === countsId(i)) return { text: t.results.departures(i + 1, departureCounts(s).total, s.wordCount), quote: false, departure: false };
    const fact = s.facts.find((f) => f.id === id);
    if (fact) return { text: fact.excerpt, quote: true, departure: fact.departure };
    const other = [...s.coverage, ...s.interpretations].find((x) => x.id === id);
    if (other) return { text: other.excerpt, quote: true, departure: false };
  }
  return null;
}

function CriterionRow({ t, label, band, result }: { t: WritingStrings; label: string; band: CriterionBand; result: WritingResult }) {
  const items = band.evidence.map((id) => evidenceItem(t, result, id)).filter((x): x is NonNullable<typeof x> => !!x);
  // Errors first: they say the most about the band; then up to 4 in all.
  const shown = [...items.filter((x) => x.departure), ...items.filter((x) => !x.departure)].slice(0, 4);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
        <span style={{ fontFamily: "'Outfit',sans-serif", fontSize: 17, color: "#141D33" }}>{label}</span>
        <span style={{ fontFamily: "'Outfit',sans-serif", fontSize: 20, color: "#141D33" }}>{band.band}</span>
      </div>
      <BandSegments value={bandValue(band.band)} />
      {band.rationale && <p style={{ margin: 0, fontSize: 14, color: "#5A5F6E", lineHeight: 1.55 }}>{band.rationale}</p>}
      {shown.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {shown.map((x, i) => (
            <span
              key={i}
              style={{
                fontSize: 13,
                lineHeight: 1.4,
                padding: "3px 9px",
                borderRadius: 8,
                background: x.departure ? "#FDF0D0" : "#F1EEE6",
                color: x.departure ? AMBER : "#5A5F6E",
                maxWidth: "100%",
                overflowWrap: "anywhere",
              }}
            >
              {x.quote ? `« ${x.text} »` : x.text}
            </span>
          ))}
        </div>
      )}
      {band.hesitation && <Note text={`${t.results.hesitation} (${band.hesitation.between.join(" / ")})`} />}
      {band.noEvidence && <Note text={t.results.noEvidence} />}
    </div>
  );
}

function Note({ text }: { text: string }) {
  return <div style={{ fontSize: 12, color: AMBER }}>{text}</div>;
}

function SurveyCard({ t, result, index }: { t: WritingStrings; result: WritingResult; index: number }) {
  const r = t.results;
  const s = result.surveys[index];
  const task = WRITING_TASKS[result.language].find((x) => x.id === s.taskId) ?? WRITING_TASKS[result.language][index];
  return (
    <div style={{ ...CARD, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ fontFamily: "'Outfit',sans-serif", fontSize: 17 }}>{r.text(index + 1, task.title)}</div>

      <Section label={`${r.yourText} · ${s.wordCount}`}>
        <p lang={result.language} style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: "#141D33", whiteSpace: "pre-wrap" }}>
          {result.texts[index]}
        </p>
      </Section>

      <Section label={r.coverage}>
        {task.points.map((p, i) => {
          const hits = s.coverage.filter((c) => c.point === i + 1);
          return (
            <div key={i} style={{ fontSize: 13, lineHeight: 1.5 }}>
              <span style={{ color: "#141D33" }}>{i + 1}. {p}</span>{" "}
              {hits.length ? (
                <span style={{ color: "#6B6F7D" }}>— {hits.map((h) => `« ${h.excerpt} »`).join(" · ")}</span>
              ) : (
                <span style={{ color: AMBER }}>— {r.notCovered}</span>
              )}
            </div>
          );
        })}
      </Section>

      <Section label={`${r.facts} · ${s.facts.length}`}>
        {FACT_CATEGORIES.filter((c) => s.facts.some((f) => f.category === c)).map((c) => (
          <div key={c} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: "#141D33" }}>{r.categories[c]}</div>
            {s.facts
              .filter((f) => f.category === c)
              .map((f) => (
                <div key={f.id} style={{ fontSize: 13, lineHeight: 1.45, color: "#5A5F6E", paddingLeft: 10, borderLeft: `2px solid ${f.departure ? "#F5B921" : "#E4E0D7"}` }}>
                  <span style={{ color: f.departure ? AMBER : "#141D33" }}>« {f.excerpt} »</span> — {f.observation}
                </div>
              ))}
          </div>
        ))}
      </Section>

      <Section label={r.interpretations}>
        {s.interpretations.length === 0 ? (
          <span style={{ fontSize: 13, color: "#8A8F9C" }}>{r.none}</span>
        ) : (
          s.interpretations.map((x) => (
            <div key={x.id} style={{ fontSize: 13, lineHeight: 1.45, color: "#5A5F6E" }}>
              « {x.excerpt} » — {r.understoodAs} {x.understoodAs}
            </div>
          ))
        )}
      </Section>

      {s.dropped.length > 0 && <div style={{ fontSize: 12, color: "#8A8F9C" }}>{r.dropped(s.dropped.length)}</div>}
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={MONO}>{label}</div>
      {children}
    </div>
  );
}
