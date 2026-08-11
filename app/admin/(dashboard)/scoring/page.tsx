import { scoreBarColor, CONFIDENCE_COLOR, ExplainerCard } from "@/components/ScoreDisplay";
import { computeCompositeCefrScore } from "@/lib/cefr-score";
import type { CefrResult, PronunciationAvg } from "@/lib/types";
import styles from "@/components/admin.module.css";

const label: React.CSSProperties = { fontSize: 13, lineHeight: 1.6, color: "#cbd5e1" };
const linkStyle: React.CSSProperties = { color: "#93c5fd", textDecoration: "underline dotted" };

// Fake, but complete: every field filled in, and the +5% bonus actually
// triggers (pronunciation and fluency both >= 9/10), so the card
// demonstrates the bonus rather than just the base case.
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
      <span style={{ width: 84, color: "#dbeafe", flexShrink: 0, textDecoration: "underline dotted", textUnderlineOffset: 3 }}>
        {rowLabel}
      </span>
      <div style={{ flex: 1, height: 5, background: "rgba(0,0,0,0.35)", borderRadius: 3 }}>
        <div style={{ width: `${pct}%`, height: "100%", background: scoreBarColor(pct), borderRadius: 3 }} />
      </div>
      <span style={{ width: 24, textAlign: "right", color: "#fff" }}>{Math.round(value)}</span>
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
          padding: 12,
          background: "linear-gradient(135deg, #1e3a8a 0%, #4f46e5 100%)",
          borderRadius: 8,
          marginBottom: 6,
          color: "#fff",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
          <a href="#score-global" style={{ color: "inherit", textDecoration: "none" }}>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.6)", fontWeight: 700, letterSpacing: 1 }}>
              ORAL ASSESSMENT
            </div>
            <div style={{ fontSize: 36, fontWeight: 800, lineHeight: 1.1, textDecoration: "underline dotted" }}>
              {composite.level}
            </div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.6)" }}>Score {composite.score}/100</div>
          </a>
          <a
            href="#score-confidence"
            style={{
              padding: "2px 8px",
              borderRadius: 10,
              fontSize: 10,
              fontWeight: 700,
              background: CONFIDENCE_COLOR[exampleResult.confidence],
              color: "#000",
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
      <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 28 }}>
        Fake, complete example — click any row for how it&apos;s computed. (Same card as a session&apos;s detail page.)
      </div>

      <ExplainerCard id="score-global" accent={accentGlobal} title="Global score (the headline number)">
        <p style={label}>
          Global score = one overall judgement from an AI, covering <a href="#score-pronunciation" style={linkStyle}>Pronunciation</a>,{" "}
          <a href="#score-fluency" style={linkStyle}>Fluency</a>, <a href="#score-vocab" style={linkStyle}>Vocab &amp; Gram.</a>, and{" "}
          <a href="#score-communication" style={linkStyle}>Communication</a> — expressed as one score (0-100) and one
          level (like B2 or C1), not four separate numbers averaged together.
        </p>
        <p style={{ ...label, marginBottom: 0 }}>
          On top of that judgement, one fixed rule applies afterwards: if two of those four hit 9 or 10/10, the score
          gets a flat +5% (capped at 100) and the level is recalculated. Example above: 82 → 86, since Pronunciation
          (9) and Fluency (9) both qualify — C1 becomes C1+.
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
          Scored by the same AI reading the transcript, but anchored to something measurable: how many words were
          spoken per minute, taken from the recording. A fixed scale converts that speaking rate into the 0-10 score
          — roughly 140 words/min lands at 9/10. It&apos;s not a free judgment call; the rate does most of the work.
        </p>
      </ExplainerCard>

      <ExplainerCard id="score-vocab" accent={accentVocab} title="Vocab & Gram.">
        <p style={{ ...label, marginBottom: 0 }}>
          Scored by the AI reading the transcript: vocabulary range and grammatical accuracy. It also checks the{" "}
          <a href="#score-pronunciation" style={linkStyle}>Pronunciation</a> score: at 60/100 or above, odd or
          wrong-looking words in the transcript are assumed to be mistakes made turning speech into text, not real
          speaker errors, and aren&apos;t penalized.
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

      <ExplainerCard title="Where">
        <p style={label}>Session list → hover the score badge.</p>
        <p style={{ ...label, marginBottom: 0 }}>
          Session detail → CEFR panel, eval lab, pronunciation lab, Speechace comparison.
        </p>
      </ExplainerCard>
    </div>
  );
}
