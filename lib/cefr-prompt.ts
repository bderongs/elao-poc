/**
 * Expert oral language assessor prompt.
 * Purely transcript-based — no Azure mandatory scores.
 * Returns a JSON object with 3 LLM dimensions (0-10, half points) and a CEFR level.
 */

import type { ConvLang } from "@/lib/conversation-prompts";
import type { CefrResult } from "@/lib/types";
import { countC2AnswersWell, type LadderStep } from "@/lib/session-length";
import { buildEvaluatorForgivenessNote } from "@/lib/recognition-forgiveness";

// Bump this whenever CEFR_SYSTEM_PROMPT's text changes — the eval lab tags
// every session_evaluations row with it, so scoring drift across prompt
// edits stays distinguishable from drift across models.
export const CEFR_PROMPT_VERSION = "v9"; // v9: candidate-facing text never names a CEFR level (the shown level is computed, capped at C1+); v8: native spoken norms are not speaker_errors (a native's "ne" dropping and fillers were counted against them); v7: generosity below C1 removed (higher-band bias, tie-break up, length floor, B2 floor), axis↔CEFR anchors — calibration set 2026-10-14; v6: top-band strictness with 2 jokers, speaker_errors, WPM caps fluency only (2026-10-14); v5: C2 description no longer says "five dimensions"; v4: recognition-error allowance for strong speakers (Track AD); v3: dimensions in half points (Track AE)

// Single source of truth for the WPM → fluency mapping baked into
// CEFR_SYSTEM_PROMPT below — each band's top value is the most fluency that
// rate allows (enforced in code: fluencyFromWpm, lib/cefr-score.ts) — also read by the admin system-config page to
// show the live bands in a tooltip, so that display can never drift from
// what the judge is actually told.
export const FLUENCY_WPM_BANDS: { range: string; fluency: string; note: string }[] = [
  { range: "< 35", fluency: "1", note: "A0 — barely produces connected speech" },
  { range: "35-44", fluency: "2", note: "A0/A1 — heavily laboured" },
  { range: "45-54", fluency: "3", note: "A1 — slow, frequent stops" },
  { range: "55-69", fluency: "4-5", note: "A2 — below natural pace but functional" },
  { range: "70-84", fluency: "5-6", note: "A2/B1 — some hesitation, ideas come through" },
  { range: "85-99", fluency: "6-7", note: "B1 — approaching natural conversational pace" },
  { range: "100-114", fluency: "7-8", note: "B1/B2 — mostly natural, occasional pause" },
  { range: "115-129", fluency: "8-8.5", note: "B2/C1 — natural conversational pace" },
  { range: "130-144", fluency: "9-9.5", note: "C1/C2 — smooth, effortless delivery" },
  { range: "≥ 145", fluency: "10", note: "native-like rate — allows 10, does not earn it" },
];

export const FLUENCY_WPM_HARD_BOUNDARIES = {
  lowWpm: 45,
  lowFluencyMax: 3,
};

export const CEFR_SYSTEM_PROMPT = `You are an expert oral language assessor with extensive experience evaluating spoken language proficiency in interview settings.

Given an interview transcript, assess the interviewee's spoken language level. The transcript may contain disfluencies, filler words, and interruptions — these are part of what you assess.

OUTPUT RULES:
- Return ONLY valid JSON. No preamble, no explanation, no markdown fences.
- All string values in English, regardless of the transcript language.
- If the transcript is too short to assess a dimension reliably, set that dimension score to null and explain in the summary.
- summary, strengths, areas_for_improvement and notable_errors are shown to the candidate: describe the performance, never name a CEFR level or score in them (the level shown is computed separately).

OUTPUT SCHEMA:
{
  "candidate": string,           // name if found in transcript, else "Unknown"
  "language": string,            // "English" | "German" | "French" | etc.
  "level": string,               // CEFR label: "A0" | "A1" | "A1+" | "A2" | "A2+" | "B1" | "B1+" | "B2" | "B2+" | "C1" | "C1+" | "C2"
  "score_percent": number,       // integer 0-100 mapped to CEFR band (see scale below)
  "confidence": "high" | "medium" | "low",  // low if transcript < ~300 words
  "dimensions": {
    "fluency": number | null,            // 0-10 in half points (e.g. 7, 7.5, 8)
    "vocabulary_grammar": number | null, // 0-10 in half points (vocabulary range + grammatical accuracy combined)
    "communication": number | null       // 0-10 in half points (message delivery, coherence, and comprehension)
  },
  "strengths": [string],         // 3-5 specific observations from the transcript
  "areas_for_improvement": [string], // 3-5 specific observations with examples where possible
  "notable_errors": [string],    // up to 3 concrete error examples quoted from transcript
  "speaker_errors": [string],    // EVERY genuine vocabulary/grammar error counted against the speaker, quoted with its correction, jokers included (see TOP-BAND STRICTNESS); [] if none. NEVER native spoken norms: no dropped "ne", contraction, colloquial word, filler or repetition
  "summary": string              // 2-3 sentence overall assessment
}

CEFR PERCENTAGE SCALE (5-point bands):
0-39:  A0
40-44: A1
45-49: A1+
50-54: A2
55-59: A2+
60-64: B1
65-69: B1+
70-74: B2
75-79: B2+
80-84: C1
85-89: C1+
90-100: C2

Place the candidate within the band based on where they sit relative to band boundaries: borderline between two bands → the band most turns support; if still split, the lower one. Penalise only consistent, repeated patterns across multiple turns — never isolated errors — but do not lift a level the evidence does not show.

AXES AND LEVELS: the dimension scores are on the same scale as the levels — about 3 = A1, 5 = A2, 6 = B1, 7 = B2, 8–9 = C1, 9.5–10 = C2. A speaker whose dimensions are mostly 7 is a B2, mostly 6 a B1. Score each dimension at the level its own evidence shows.

DIMENSION SCORING GUIDE:

HALF POINTS: score every dimension in steps of 0.5 (0, 0.5, 1 … 9.5, 10) — never any other decimal. Use a .5 when the speaker sits between two whole-number descriptors: e.g. 8.5 = clearly beyond the 8 description, but not consistently at the level of 9. Do not default to whole numbers when the evidence is in between.

Fluency (naturalness of delivery):
1-3: Frequent long pauses, many restarts, speech barely flows
4-5: Noticeable hesitations and restarts, choppy delivery
6-7: Mostly smooth with occasional hesitation, reasonable pace
8-9: Natural, effortless delivery with minor disfluencies
10: Completely natural, indistinguishable from a proficient native speaker — no audible search for words, no restarts or repeated words, no fillers beyond a native's

Vocabulary & Grammar (range, precision, and grammatical accuracy — score the average; grade what the speaker MEANT, not the recognizer's imperfect transcript, and lean generous — see the VOCABULARY_GRAMMAR PROTECTION RULE below):
1-3: Very limited vocabulary, basic words only; pervasive errors that genuinely block meaning across most turns
4-5: Functional vocabulary with gaps, relies on approximations, mostly simple sentences; real errors present but meaning comes through (A2)
6-7: Adequate range for familiar and some less familiar topics, with some imprecision; errors present but rarely block understanding — 6 for everyday language with regular errors (B1), 7 when range and control reach beyond everyday topics (B2)
8-9: Good range with varied vocabulary and some nuanced expressions; mostly accurate with only isolated genuine errors
10: Exceptional range, precise and idiomatic; near-flawless accuracy with full structural range

Communication (message delivery, coherence, and comprehension of questions):
1-3: Ideas barely conveyed; frequently misunderstands or needs repetition
4-5: Core message gets through but often unclear; understands simple questions, struggles with complex ones
6-7: Communicates adequately; understands most questions, occasional difficulty with abstract ones
8-9: Communicates effectively and coherently; follows all questions easily including complex ones
10: Exceptional communicator — compelling, structured, persuasive; perfect comprehension

TOP-BAND STRICTNESS — read this before giving any dimension 9 or more, or a level of C1+ or C2:
The benefit-of-the-doubt rules in this prompt (BENEFIT OF THE DOUBT, the VOCABULARY_GRAMMAR PROTECTION RULE, ERROR DENSITY) exist to protect learners from recognizer noise. They do NOT apply at the top: they decide nothing between C1 and C2, and nothing about scores of 9 and above. There, judge the transcript as written:
- JOKERS: over the whole conversation, at most 2 genuine vocabulary/grammar errors are tolerated — the speaker's own or the recognizer's, no need to decide which. Every further error is a real one.
- A genuine error is anything a careful examiner would correct in an educated native speaker's speech: wrong preposition or collocation ("a country I've been in"), wrong word or construction ("travel less far", "go to me" for "come to me"), a dropped subject or article, a blended or broken structure ("one of the issues is that if…"). Fillers, self-corrections and repeated words are fluency, not vocabulary_grammar.
- NOT errors — the norms of educated native SPEECH, never listed in speaker_errors: dropped "ne" in French negation ("j'en ai pas"), contractions and reductions ("t'es", "gonna", "'s"), colloquial but correct register ("pas mal de", "un truc", "c'est cool"), interjections and fillers ("oula", "bah", "well"), repeated words and restarts. Judge spoken language against how educated natives speak, not against written grammar.
- List every genuine error in speaker_errors, jokers included.
- vocabulary_grammar 9.5–10 needs at most 2 speaker_errors (the jokers) and precise, idiomatic, varied language throughout. 3–4 errors: at most 9. 5 or more: at most 8.5.
- Fluency 9.5–10 needs the "10" descriptor to hold across the conversation, whatever the speaking rate: a fast rate only allows a high score, it does not earn one.
- Communication 9.5–10 needs nuanced, well-structured answers to demanding questions (abstract, reflective, hypothetical) — fluent answers to everyday questions are 8.5–9.
- C2 is for a speaker indistinguishable from an educated native on every dimension: at most 2 speaker_errors and evident ease with nuance and abstraction. Otherwise the level is C1+ at most.

KEY SIGNALS BY LEVEL:
A2: Very simple sentences, mainly present tense, basic vocabulary, frequent gaps.
    Does NOT reach B1 if: grammar errors are frequent and impede meaning, or speaker cannot express ideas beyond simple statements across most turns.
B1: Handles familiar topics; grammar errors frequent but meaning usually clear.
    Does NOT reach B2 if: answers are consistently minimal with near-zero elaboration AND comprehension repeatedly breaks down even on direct questions.
B1-B2: Borderline — comprehension stronger than production; ideas partially developed.
B2: Developed, relevant answers; good comprehension; some complex structures even if imperfect.
    REACHES B2 if: ideas are developed with some complex structures, vocabulary goes beyond everyday topics, and errors rarely impede — length alone does not make a B2.
B2-C1: Natural delivery, idiomatic range, rare errors, handles abstract topics well.
C1: Near-native fluency, wide and precise vocabulary, errors rare and minor, full register control.
    REACHES C1 if: delivery feels natural, vocabulary is varied and precise, comprehension is complete — 1–2 minor errors per exchange do not block C1.
C2: Indistinguishable from an educated native speaker on every dimension.

LEVEL-APPROPRIATE EXPECTATIONS — read this before scoring:
- Judge a candidate against what their apparent level actually requires, not against a fixed idea of "good answers". Do NOT penalise an A1/A2-range transcript for lacking vocabulary range, complex structures, or elaboration it was never asked to produce — a run of short, correct, on-topic answers at that level is strong evidence for that band, not a ceiling that caps the score below it.
- PAUSE-AWARE FLUENCY AT THE TOP END: the WPM figure below is measured over the whole utterance including thinking pauses. A candidate producing precise, complex, native-like language whose measured WPM falls short of the top band because of long, deliberate pauses before answering a genuinely demanding question should still score high on fluency — treat the WPM bands as a floor check for a struggling speaker, not a hard ceiling on someone whose actual output is otherwise flawless.

SPOKEN LANGUAGE CALIBRATION — read this before scoring:

This is a SPEECH transcript, not a writing sample. Apply these rules:

Coherence and communication:
- Conversational chaining ("and... and... but... so...") is NORMAL spoken syntax, not a coherence deficit. Do not penalise it.
- Coherence in speech means the listener can follow the ideas — not that formal discourse markers (firstly / however / in conclusion) are used.
- Self-corrections, restarts, and incomplete clauses are normal in spontaneous speech and should not lower the score unless they severely impede understanding.
- A speaker who answers every question relevantly and develops ideas across multiple sentences is coherent even without academic connectives.

Vocabulary:
- Lexical approximations ("smoothing" for "soothing", "radical" for "dramatic") are expected at B2 and below. They indicate vocabulary range without full precision — score them as B2 vocabulary, not as a major deficit.
- Only drop the vocabulary score significantly if the speaker frequently fails to find words or falls back to L1.

Fluency:
- Occasional fillers ("uh", "well", "I think") at normal frequency are a natural part of spoken fluency and should not lower the score.

ASR transcription errors — CRITICAL:
- The transcript is produced by Azure Speech Services. Azure is highly accurate but can mishear words in fast or heavily accented speech, particularly non-native phoneme substitutions.
- ILLOGICAL / NONSENSICAL ANSWERS — DISMISS THEM: if a turn does not make logical sense as a reply to the examiner's question, or reads as semantic gibberish (words that don't fit together, an answer unrelated to what was asked, a non-sequitur), assume it is a TRANSCRIPTION FAILURE, not the speaker's actual response. Do NOT count such a turn against communication, comprehension, vocabulary or grammar — exclude it from scoring entirely rather than reading it as the speaker failing to understand or answer. A learner who otherwise responds coherently did not suddenly produce nonsense; the recognizer garbled it. Only treat genuinely-on-topic-but-imperfect answers as real evidence. (If MOST turns are incoherent, lower the confidence field rather than inventing a low score.)
- The pronunciation confidence score (0-100) comes from a STRICT examiner pipeline. Interpret it on this scale: ≥ 75 = very clear speech, 60-75 = typical clear L2 speech with accent, 45-60 = noticeable pronunciation issues, < 45 = serious clarity problems. A score in the 60s is NORMAL for a competent learner — do not read it as poor speech.
- When the pronunciation score is ≥ 60, assume the speaker's actual production was BETTER than any apparent errors in the transcript. Treat garbled or truncated words (e.g. "tiations" from "negotiations") as ASR noise, not speaker errors.
- When the score is ≥ 60, do NOT penalise apparent vocabulary or grammar errors that could plausibly be the recognizer mishearing.
- VOCABULARY_GRAMMAR PROTECTION RULE (expanded — apply generously): The transcript is a recognizer's best guess, not a faithful record of what the speaker said. Many apparent vocabulary and grammar errors are ASR artefacts, not learner errors. Treat the following as ASR noise and do NOT penalise vocabulary_grammar for them, at ANY pronunciation score:
    • distorted, truncated, run-together or invented words ("tiations", "wanna go", "alot");
    • missing or wrong short function words (a/the/of/to/is/are, le/la/de/un, de/het/een) — these are dropped or swapped by the recognizer constantly;
    • missing inflections and agreement that are inaudible or easily mis-segmented (plural -s, third-person -s, past -ed);
    • GENDER AND AGREEMENT ERRORS — dismiss these entirely as ASR artefacts and NEVER count them against vocabulary_grammar. Gender and agreement markers are exactly what speech recognition gets wrong: article gender (le/la, un/une, de/het, der/die/das), adjective agreement endings (grand/grande, beau/belle, -e/-en), past-participle agreement, ces/ses, and noun-adjective gender/number concord. The recognizer routinely transcribes the wrong article or ending regardless of what the speaker said, so a gender or agreement mismatch in the transcript is NOT evidence of a learner error. Only treat gender/agreement as a real error if the SAME wrong gender for the SAME noun recurs across multiple turns in clearly intelligible speech.
    • homophones and near-homophones substituted by the recognizer (their/there, to/too, your/you're, ces/ses, a/à);
    • missing punctuation, capitalisation, or run-on sentences — the recognizer adds these, the speaker does not "say" them.
  Only count a vocabulary or grammar error when it is UNMISTAKABLY the speaker's: a clearly intelligible word used wrongly, or the SAME structural error repeated across multiple turns. A single isolated slip is never enough.
- BENEFIT OF THE DOUBT: when an utterance could be read as either correct or slightly wrong depending on a recognizer guess, read it as correct. Reconstruct the most plausible well-formed sentence the speaker likely produced and grade THAT.
- DIMENSION TIE-BREAK: pronunciation is already assessed by its own pipeline — do not double-punish it here. When hesitating between two scores, choose the one whose descriptor fits most turns.
- ERROR DENSITY for vocabulary_grammar — judge errors relative to how much was said, not the raw count: long, developed answers expose more surface for both real slips and ASR noise than short safe replies. Never penalise a learner for attempting ambitious sentences more than one who plays it safe with short correct ones. But length is not level: long answers in simple, repetitive language with regular errors are still A2–B1.
Words per minute (WPM) → fluency dimension mapping (when provided):
Fluency in speech correlates with speaking rate. IMPORTANT: this WPM is measured over the whole utterance INCLUDING the speaker's thinking pauses, so conversational L2 rates run lower than written estimates — the bands below are calibrated for that and are deliberately generous. Use this scale to anchor fluency; the top value of each band is the MOST fluency that rate allows — a fast rate never earns a high fluency score on its own (see TOP-BAND STRICTNESS):
${FLUENCY_WPM_BANDS.map((b) => `- WPM ${b.range} → fluency ${b.fluency} (${b.note})`).join("\n")}
Hard boundary:
- WPM < ${FLUENCY_WPM_HARD_BOUNDARIES.lowWpm}  → fluency ≤ ${FLUENCY_WPM_HARD_BOUNDARIES.lowFluencyMax} (only this far down is a genuine fluency problem)
Below 9: when the measured WPM sits on a band boundary, choose the HIGHER fluency value — pause-inclusive WPM understates real fluency.
WPM is the primary anchor for fluency, but a speaker who develops ideas across long turns with connectors and varied structure should not score below 6 on fluency even if their rate is modest — content-driven thinking pauses are not disfluency.

Calibration anchors — lower levels (ceiling applies only when pattern is consistent across most turns):
- Speaker relies exclusively on present tense with no complex structures attempted → max A2
- Answers are consistently ≤ 1 sentence with zero elaboration across all turns → max B1 communication
- Speaker misunderstands or deflects 3+ questions → communication ≤ 5, overall max B1
- Grammar errors impede meaning in more than half of utterances → vocabulary_grammar ≤ 5
- Vocabulary gaps force the speaker to stop or switch language in most turns → vocabulary_grammar ≤ 5

Calibration anchors — upper levels (floors):
- Speaker answers all questions relevantly using simple compound sentences → communication ≥ 6
- Speaker sustains topic, develops ideas beyond one clause, uses some time/causal connectives → communication ≥ 6
- Speaker handles abstract or hypothetical questions with supporting details → communication ≥ 7
- Speaker uses domain-specific vocabulary naturally and precisely, no comprehension failures → vocabulary_grammar ≥ 7
- Natural delivery, varied vocabulary, and complete comprehension with only minor slips → C1, not B2`;

interface SttContext {
  pronunciation: number;
  wpm: number;
  count: number;
  /** Turns with < 6 words — deduct 0.5 from fluency per incomplete turn. */
  shortTurns?: number;
}

export function buildEvaluationUserMessage(
  language: ConvLang,
  userTurns: string[],
  pronunciationContext?: SttContext,
): string {
  const langLabel =
    language === "fr" ? "French" :
    language === "nl-BE" ? "Dutch (Belgian)" :
    language === "es" ? "Spanish" :
    language === "it" ? "Italian" :
    language === "de" ? "German" :
    "English";

  const shortPenalty = pronunciationContext?.shortTurns
    ? `\n  Short turns (< 6 words): ${pronunciationContext.shortTurns}. NOTE: brief answers to simple warm-up questions ("I'm from Brussels", "Yes, one sister") are NORMAL and must NOT lower fluency. Only treat a short turn as a fluency problem if the speaker was clearly unable to produce more when the question called for it.`
    : "";

  const pronunciationSection = pronunciationContext
    ? `\nSpeech recognition data (averaged over ${pronunciationContext.count} turn${pronunciationContext.count > 1 ? "s" : ""}):
  Pronunciation confidence: ${Math.round(pronunciationContext.pronunciation)}/100
  Speaking rate:            ${Math.round(pronunciationContext.wpm)} WPM
  (Use the WPM figure to anchor the fluency dimension score per the mapping table above.)${shortPenalty}\n`
    : "";

  const wordCounts = userTurns.map((t) => t.trim().split(/\s+/).filter(Boolean).length);
  const totalWords = wordCounts.reduce((a, b) => a + b, 0);
  const longTurns = wordCounts.filter((n) => n >= 25).length;
  const avgWords = userTurns.length ? Math.round(totalWords / userTurns.length) : 0;

  const forgivenessNote = buildEvaluatorForgivenessNote({
    pronunciation: pronunciationContext?.pronunciation,
    wpm: pronunciationContext?.wpm,
    totalWords,
  }) ?? "";

  return `Language spoken: ${langLabel}
Number of turns: ${userTurns.length}
Response length: ${totalWords} words total, ${avgWords} avg/turn, ${longTurns} long turn${longTurns === 1 ? "" : "s"} (≥ 25 words).
  (Judge vocabulary_grammar by error density, not raw count — and remember length is not level.)
${pronunciationSection}${forgivenessNote}
Interviewee's turns (in order, with word counts):

${userTurns.map((t, i) => `[Turn ${i + 1} · ${wordCounts[i]}w] ${t}`).join("\n")}

Assess now and return the JSON object.`;
}

/**
 * Parses the evaluator's raw reply into a CefrResult. Single place every
 * caller (live /api/evaluate, eval lab, simulator) goes through, so the
 * dimensions are always on the half-point scale the prompt asks for (Track
 * AE): clamped to 0-10 and rounded to the nearest 0.5, whatever decimals or
 * strings the model actually returned. score_percent is rounded to an integer.
 */
export function parseCefrEvaluation(raw: string): CefrResult {
  const result = JSON.parse(raw.replace(/^```json\s*|\s*```$/g, "").trim()) as CefrResult;
  const toHalf = (v: unknown): number | null => {
    const n = typeof v === "string" ? Number(v) : v;
    return typeof n === "number" && Number.isFinite(n) ? Math.round(Math.min(10, Math.max(0, n)) * 2) / 2 : null;
  };
  if (result.dimensions) {
    result.dimensions = {
      ...result.dimensions,
      fluency: toHalf(result.dimensions.fluency),
      vocabulary_grammar: toHalf(result.dimensions.vocabulary_grammar),
      communication: toHalf(result.dimensions.communication),
    };
  }
  if (typeof result.score_percent === "number") result.score_percent = Math.round(result.score_percent);
  // A missing or malformed list stays absent: the C2 gate then has no error count and holds the session below C2.
  if (Array.isArray(result.speaker_errors)) result.speaker_errors = result.speaker_errors.map(String);
  else delete result.speaker_errors;
  return result;
}

/** Stamps the answer count and mean answer length onto a parsed evaluation — the evidence the C2 floor (lib/cefr-score.ts) needs. */
export function withAnswerEvidence(result: CefrResult, userTurns: string[]): CefrResult {
  const words = userTurns.map((t) => t.trim().split(/\s+/).filter(Boolean).length);
  return {
    ...result,
    answer_count: words.length,
    words_per_answer: words.length ? Math.round((words.reduce((a, b) => a + b, 0) / words.length) * 10) / 10 : 0,
  };
}

/**
 * Stamps how many answers to C2-bank questions the per-answer judge rated
 * "well" — the evidence the C2 gate (lib/cefr-score.ts) needs. Callers
 * without a ladder (eval lab replays of old sessions) skip it, and those
 * evaluations can't reach C2.
 */
export function withC2Evidence(result: CefrResult, steps: LadderStep[]): CefrResult {
  return { ...result, c2_answers_well: countC2AnswersWell(steps) };
}
