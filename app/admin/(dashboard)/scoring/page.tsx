import { scoreBarColor, CONFIDENCE_COLOR, ExplainerCard } from "@/components/ScoreDisplay";
import { computeCompositeCefrScore } from "@/lib/cefr-score";
import type { CefrResult, PronunciationAvg } from "@/lib/types";
import { adminColors } from "@/lib/admin-theme";
import styles from "@/components/admin.module.css";

const label: React.CSSProperties = { fontSize: 13, lineHeight: 1.6, color: adminColors.text };
const linkStyle: React.CSSProperties = { color: adminColors.ink, textDecoration: "underline dotted" };

// Fake, but complete: every field filled in — a typical C1 profile (axes 8–9,
// mean 8.5), so the card shows the curve keeping it in C1.
const exampleResult: CefrResult = {
  candidate: "Example",
  language: "English",
  level: "C1",
  score_percent: 82,
  confidence: "high",
  dimensions: { fluency: 9, vocabulary_grammar: 8, communication: 8 },
  strengths: ["Wide, natural vocabulary range", "Confident pacing, minimal hesitation"],
  areas_for_improvement: ["Occasional article/preposition slips"],
  notable_errors: ['"he go" instead of "he goes"'],
  summary: "Confident, natural speaker with minor grammar slips.",
};
const examplePronunciation: PronunciationAvg = { pronunciation: 90, wpm: 138, score: 90, count: 6, shortTurns: 0 };
const composite = computeCompositeCefrScore(exampleResult, examplePronunciation);

const accentGlobal = scoreBarColor(composite.score);
const accentConfidence = CONFIDENCE_COLOR[exampleResult.confidence];
const accentPronunciation = scoreBarColor(examplePronunciation.pronunciation);
const accentFluency = scoreBarColor(exampleResult.dimensions.fluency! * 10);
const accentVocab = scoreBarColor(exampleResult.dimensions.vocabulary_grammar! * 10);
const accentCommunication = scoreBarColor(exampleResult.dimensions.communication! * 10);

function LinkedBar({ href, label: rowLabel, value, max = 100 }: { href: string; label: string; value: number; max?: number }) {
  const pct = Math.round((value / max) * 100);
  return (
    <a
      href={href}
      style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, marginBottom: 4, textDecoration: "none", color: "inherit" }}
    >
      <span style={{ width: 84, color: adminColors.ink, flexShrink: 0, textDecoration: "underline dotted", textUnderlineOffset: 3 }}>
        {rowLabel}
      </span>
      <div style={{ flex: 1, height: 5, background: adminColors.border, borderRadius: 3 }}>
        <div style={{ width: `${pct}%`, height: "100%", background: adminColors.ink, borderRadius: 3 }} />
      </div>
      <span style={{ width: 24, textAlign: "right", color: adminColors.ink }}>{Math.round(value)}</span>
    </a>
  );
}

export default function ScoringGuidePage() {
  return (
    <div>
      <h1 className={styles.pageTitle}>Scoring, explained</h1>

      <div
        style={{
          maxWidth: 340,
          padding: 20,
          background: adminColors.surface,
          border: `1px solid ${adminColors.border}`,
          borderRadius: 14,
          marginBottom: 6,
          color: adminColors.ink,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
          <a href="#score-global" style={{ color: "inherit", textDecoration: "none" }}>
            <div style={{ fontSize: 11, color: adminColors.faint, fontWeight: 400, letterSpacing: "0.12em" }}>
              ORAL ASSESSMENT
            </div>
            <div style={{ fontSize: 36, fontWeight: 400, lineHeight: 1.1, textDecoration: "underline dotted", fontFamily: "'Outfit',sans-serif" }}>
              {composite.level}
            </div>
            <div style={{ fontSize: 12, color: adminColors.text }}>Score {composite.score}/100</div>
          </a>
          <a
            href="#score-confidence"
            style={{
              padding: "3px 9px",
              borderRadius: 100,
              fontSize: 10,
              fontWeight: 700,
              background: adminColors.accentTint,
              border: `1px solid ${adminColors.accentBorder}`,
              color: adminColors.accentInk,
              marginTop: 4,
              textDecoration: "none",
            }}
          >
            {exampleResult.confidence.toUpperCase()}
          </a>
        </div>

        <LinkedBar href="#score-pronunciation" label="Pronunciation" value={examplePronunciation.pronunciation / 10} max={10} />
        <LinkedBar href="#score-fluency" label="Fluency" value={exampleResult.dimensions.fluency!} max={10} />
        <LinkedBar href="#score-vocab" label="Vocab & Gram." value={exampleResult.dimensions.vocabulary_grammar!} max={10} />
        <LinkedBar href="#score-communication" label="Communication" value={exampleResult.dimensions.communication!} max={10} />
      </div>
      <div style={{ fontSize: 11, color: adminColors.faint, marginBottom: 28 }}>
        Fake, complete example — click any row for how it&apos;s computed. (Same card as a session&apos;s detail page.)
      </div>

      <ExplainerCard id="score-global" accent={accentGlobal} title="Global score (the headline number)">
        <p style={label}>
          Global score = the average of the four scores below (<a href="#score-pronunciation" style={linkStyle}>Pronunciation</a>,{" "}
          <a href="#score-fluency" style={linkStyle}>Fluency</a>, <a href="#score-vocab" style={linkStyle}>Vocab &amp; Gram.</a>, and{" "}
          <a href="#score-communication" style={linkStyle}>Communication</a>), put on a 0-100 scale and converted to a
          level (like B2 or C1) in 5-point steps. Before 2026-10-08 it was the AI&apos;s own overall judgement instead of
          the average.
        </p>
        <p style={label}>
          Fluency, Vocab &amp; Gram. and Communication are scored in half points (e.g. 7.5/10). Up to an average of 8
          the scale is simply × 10 (7 → 70, B2; 8 → 80, C1). Above 8 it is stretched, because the AI scores a C1
          speaker 8-9 on each dimension: an average of 9 gives 87 (C1+). Example above: average 8.5 →{" "}
          {composite.score}, {composite.level}.
        </p>
        <p style={{ ...label, marginBottom: 0 }}>
          <strong>The scale stops at C1+ (89).</strong> A short conversation can&apos;t reliably tell C1 from C2 — the
          AI scores a strong C1 speaker and a native speaker about the same — so the test doesn&apos;t report C2.
          When a C1+ candidate also answered at least 2 of the C2 questions well, with an average of 8.75 or more, the
          result says they are at the top of what the test measures and may be higher still. The C2 questions are
          still asked: they separate C1 from C1+ and trigger that message. History: until 2026-10-14 a +5% bonus and a
          &quot;C2 floor&quot; lifted C1 speakers into C2; from 2026-10-14 to 2026-10-18 C2 needed C2-question
          evidence and at most 2 counted errors, which proved too noisy (false errors on natives).
        </p>
      </ExplainerCard>

      <ExplainerCard id="score-confidence" accent={accentConfidence} title="Confidence">
        <p style={{ ...label, marginBottom: 0 }}>
          How sure the AI is about its own scores — mainly driven by how much the person actually said. Short
          conversations (roughly under 300 words) get marked Low.
        </p>
      </ExplainerCard>

      <ExplainerCard id="score-pronunciation" accent={accentPronunciation} title="Pronunciation">
        <p style={label}>
          Computed by a different system than the one scoring the rest — this one listens to the actual recording,
          not the transcript. It rates how clearly each word was pronounced (0-100), shown here ÷ 10.
        </p>
        <p style={label}>
          That same listening pass also measures speaking rate (words per minute) — a separate number, used by{" "}
          <a href="#score-fluency" style={linkStyle}>Fluency</a> below. The pronunciation score itself is what{" "}
          <a href="#score-vocab" style={linkStyle}>Vocab &amp; Gram.</a> checks.
        </p>
        <p style={label}>
          Two approaches currently exist, and they don&apos;t score a recording identically:
        </p>
        <p style={label}>
          <strong>Established:</strong> two separate listening passes — one produces a transcript with a confidence
          number per word, one measures phoneme-level accuracy — then an AI reads both and rates each word.
        </p>
        <p style={{ ...label, marginBottom: 0 }}>
          <strong>Newer:</strong> a single audio-capable AI listens to the recording directly and both transcribes
          and rates pronunciation in one pass, no separate listening step. In testing against a third-party reference
          on the same recordings, the established approach scored well above it and the newer one scored a bit below
          it — so the newer one is calibrated more generously to close that gap. The two aren&apos;t directly
          comparable numbers.
        </p>
      </ExplainerCard>

      <ExplainerCard id="score-fluency" accent={accentFluency} title="Fluency">
        <p style={{ ...label, marginBottom: 0 }}>
          Scored by the same AI reading the transcript, with a measurable limit: how many words were spoken per
          minute, taken from the recording. A fixed scale gives the most fluency each speaking rate allows (in half
          points) — e.g. roughly 120 words/min allows at most 8.5/10. The rate can only lower the AI&apos;s score, never
          raise it: speaking fast doesn&apos;t earn a 10, the AI has to hear native-like delivery (no searching for
          words, no restarts). Applies when there is enough speech to measure the rate reliably (at least 3 answers
          and 100 words, and a plausible rate). From 2026-10-08 to 2026-10-14 the rate also raised the score.
        </p>
      </ExplainerCard>

      <ExplainerCard id="score-vocab" accent={accentVocab} title="Vocab & Gram.">
        <p style={{ ...label, marginBottom: 0 }}>
          Scored by the AI reading the transcript: vocabulary range and grammatical accuracy. It also checks the{" "}
          <a href="#score-pronunciation" style={linkStyle}>Pronunciation</a> score: at 60/100 or above, odd or
          wrong-looking words in the transcript are assumed to be mistakes made turning speech into text, not real
          speaker errors, and aren&apos;t penalized. That benefit of the doubt stops at the top: for 9/10 or more (and
          for C1+/C2) only 2 errors in the whole conversation are let off as &quot;jokers&quot;, and every further one
          counts. The AI lists the errors it counted (shown in the admin; they no longer decide the level).
        </p>
      </ExplainerCard>

      <ExplainerCard id="score-communication" accent={accentCommunication} title="Communication">
        <p style={{ ...label, marginBottom: 0 }}>
          Scored by the AI reading the transcript: whether the message came across clearly and whether the questions
          asked were understood.
        </p>
      </ExplainerCard>

      <ExplainerCard title="Speechace">
        <p style={{ ...label, marginBottom: 0 }}>
          Import their scores + audio. Run ours on the same recordings. Closest-first Δ comparison.
        </p>
      </ExplainerCard>

      <ExplainerCard title="Changing the scoring? Replay it first">
        <p style={label}>
          Before shipping a change to the formula (the curve, level thresholds, the C2 gate…), replay it on the
          sessions already stored to see which ones would change level. It is a developer tool: nothing is changed
          in the database and no AI is called.
        </p>
        <p style={label}>
          Run <code>npm run analysis:scoring -- --scenario &lt;name&gt;</code> from the project (
          <code>--list</code> shows the available scenarios). Reports list each session&apos;s level before and after.
        </p>
        <p style={{ ...label, marginBottom: 0 }}>
          How to read the report, add your own scenario and ship a change: <code>analysis/README.md</code> in the
          repository.
        </p>
      </ExplainerCard>

      <ExplainerCard title="Where">
        <p style={label}>Session list → hover the score badge.</p>
        <p style={{ ...label, marginBottom: 0 }}>
          Session detail → CEFR panel, eval lab, pronunciation lab, Speechace comparison.
        </p>
      </ExplainerCard>
    </div>
  );
}
