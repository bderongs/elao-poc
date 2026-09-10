/**
 * DEV-TEST SCAFFOLD — NOT wired into lib/system-config.ts or the admin Lab
 * Panel. Exists only so this can be exercised from a standalone script /
 * this chat, per 2026-09-09 discussion: is Qwen3-Omni's one-step audio
 * assessment more accurate than Voxtral's (lib/pronunciation/providers/voxtral.ts)
 * at low CEFR levels (A1/A2), where the Voxtral-vs-SpeechAce comparison in
 * lib/pronunciation-rollup.ts:16-18 caused a revert to azure-ensemble?
 *
 * Deliberately mirrors voxtral.ts's shape and reuses its exact SYSTEM_PROMPT
 * so the model is the only variable being compared. If this pans out, promote
 * it properly: register in system-config.ts, add to the Lab Panel, decide on
 * a real DashScope client module instead of the inline fetch below.
 *
 * DASHSCOPE_API_KEY never leaves the server. Uses Alibaba Cloud DashScope's
 * OpenAI-compatible endpoint — international (Singapore) by default; set
 * QWEN_DASHSCOPE_BASE_URL to switch to the mainland endpoint
 * (https://dashscope.aliyuncs.com/compatible-mode/v1) if the key requires it.
 * Docs: https://www.alibabacloud.com/help/en/model-studio/qwen-omni
 */

import { assessProcessLabel } from "@/lib/turn-labels";
import { logServerEvent } from "@/lib/server-log";
import { SYSTEM_PROMPT } from "@/lib/pronunciation/providers/voxtral";
import type { PronunciationProvider, PronunciationAssessParams, PronunciationResult } from "@/lib/pronunciation/types";

const DEFAULT_BASE_URL = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";

function qwenModel(): string {
  return process.env.QWEN_MODEL ?? "qwen3-omni-flash";
}

function baseUrl(): string {
  return process.env.QWEN_DASHSCOPE_BASE_URL ?? DEFAULT_BASE_URL;
}

const LANG_LABELS: Record<string, string> = {
  fr: "French", "nl-BE": "Dutch (Belgian)", es: "Spanish", it: "Italian", de: "German", en: "English",
};

interface QwenJudgeWord {
  w: string;
  v: "good" | "ok" | "off" | "bad";
}

interface QwenJudgeResult {
  transcript: string;
  turn_score: number;
  words: QwenJudgeWord[];
  summary?: string;
}

// Same verdict→score mapping as voxtral.ts, duplicated rather than imported:
// this scaffold intentionally does NOT inherit Voxtral's score calibration
// (that map was tuned specifically to Voxtral's observed bias vs SpeechAce —
// see the comment above VERDICT_MAP there). Qwen needs its own calibration
// pass once there's SpeechAce-comparison data to tune against; until then
// this is an untuned placeholder using the same "good/ok/off/bad" scale the
// shared prompt asks for.
const VERDICT_MAP: Record<string, { confidence: number; accuracyScore: number; errorType: string }> = {
  good: { confidence: 1.0, accuracyScore: 96, errorType: "None" },
  ok: { confidence: 0.75, accuracyScore: 82, errorType: "None" },
  off: { confidence: 0.5, accuracyScore: 48, errorType: "Mispronunciation" },
  bad: { confidence: 0.2, accuracyScore: 16, errorType: "Mispronunciation" },
};

/** DashScope's documented audio formats are AMR/WAV/3GP/3GPP/AAC/MP3 — best-effort map from our recorder's content-types. */
function audioFormat(contentType: string): string {
  const ct = contentType.toLowerCase();
  if (ct.includes("wav")) return "wav";
  if (ct.includes("amr")) return "amr";
  if (ct.includes("3gp")) return "3gp";
  // m4a/mp4 containers are near-universally AAC audio; best effort like
  // voxtral.ts's equivalent guess.
  if (ct.includes("mp4") || ct.includes("m4a") || ct.includes("aac")) return "aac";
  if (ct.includes("mp3") || ct.includes("mpeg")) return "mp3";
  // ogg/webm aren't in DashScope's documented format list — pass through and
  // let the API reject it explicitly rather than silently mis-decoding.
  return contentType.toLowerCase().includes("ogg") ? "ogg" : "webm";
}

interface DashScopeStreamChunk {
  choices?: Array<{ delta?: { content?: string } }>;
}

async function dashscopeChatComplete(params: {
  model: string;
  system: string;
  base64Audio: string;
  format: string;
  userText: string;
  /** Defaults to 0 — deterministic by default so prompt-iteration comparisons
   *  aren't confounded by sampling noise (see 2026-09-09 3-different-transcripts
   *  incident on c2fa80af, which turned out to need this ruled out first). */
  temperature?: number;
}): Promise<string> {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new Error("DASHSCOPE_API_KEY missing");

  const res = await fetch(`${baseUrl()}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: params.model,
      messages: [
        { role: "system", content: params.system },
        {
          role: "user",
          content: [
            {
              type: "input_audio",
              input_audio: { data: `data:;base64,${params.base64Audio}`, format: params.format },
            },
            { type: "text", text: params.userText },
          ],
        },
      ],
      // Text-only output — we don't want Qwen's speech (TTS) reply, just the
      // JSON judgment. DashScope's Omni endpoint requires streaming regardless.
      modalities: ["text"],
      stream: true,
      temperature: params.temperature ?? 0,
      // Was previously unset, i.e. whatever small default DashScope applies —
      // the "Unterminated string in JSON" parse failures seen on 2026-09-09
      // (9aa668f3, then reliably at temperature=0) were the response getting
      // cut off mid-transcript, not a model-quality issue. Matches voxtral.ts's
      // maxTokens: 2000.
      max_tokens: 2000,
    }),
  });

  if (!res.ok || !res.body) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(`DashScope API ${res.status}: ${bodyText.slice(0, 500)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") return text;
      try {
        const parsed = JSON.parse(payload) as DashScopeStreamChunk;
        text += parsed.choices?.[0]?.delta?.content ?? "";
      } catch {
        // Ignore malformed SSE lines (e.g. keep-alive comments).
      }
    }
  }

  // If the connection closed without a trailing "\n" after the final data
  // line (no clean [DONE]/blank-line termination — seen intermittently
  // against the DashScope intl endpoint), that line is still sitting unread
  // in `buffer` and was never fed through the loop above. Flush it now
  // instead of silently dropping the tail of the JSON, which produced
  // "Unterminated string" parse failures downstream (2026-09-09).
  const trimmed = buffer.trim();
  if (trimmed.startsWith("data:")) {
    const payload = trimmed.slice(5).trim();
    if (payload && payload !== "[DONE]") {
      try {
        const parsed = JSON.parse(payload) as DashScopeStreamChunk;
        text += parsed.choices?.[0]?.delta?.content ?? "";
      } catch {
        // Still malformed even after flushing — give up, let the caller's
        // outer JSON.parse surface the failure.
      }
    }
  }

  return text;
}

// Alternate system prompt for the low-level-focused re-run (2026-09-09):
// c2fa80af scored SpeechAce pronunciation=23.3 but Voxtral transcribed the
// audio as a pristine match to the exam question and scored it 95 — the same
// hallucinate-toward-fluent-text failure that triggered the original revert
// (lib/pronunciation-rollup.ts:16-18). Same JSON schema as SYSTEM_PROMPT so
// results stay comparable; the difference is explicit permission/instruction
// to transcribe broken, non-fluent speech literally instead of smoothing it
// into something a fluent speaker would plausibly have said.
export const LOW_LEVEL_SYSTEM_PROMPT = `You are an expert phonetician assessing the spoken pronunciation of a second-language learner, from a proficiency PLACEMENT TEST. A large fraction of speakers at this stage are true beginners (CEFR A0-A2): halting, fragmented, heavily accented, sometimes only able to produce isolated words or a garbled attempt at the question they were asked. You are given the learner's audio directly — listen to it yourself; you are not given any transcript or other engine's output.

CRITICAL — do not default to a clean, fluent-sounding transcript. Language models have a strong bias toward transcribing audio as the most plausible/grammatical sentence in the language, even when that isn't what was actually said. Actively resist that bias here:
- Transcribe ONLY the words/sounds you can actually make out, exactly as pronounced — including false starts, repeated words, self-corrections, and fillers ("euh", "um").
- If a word is mispronounced badly enough that you're guessing at the intended word from context, mark it "bad" — do NOT silently normalize it into the clean/expected word in the transcript.
- If the recording sounds like disconnected, effortful fragments rather than a fluent sentence, your transcript must look like disconnected, effortful fragments too. A struggling beginner rarely produces a grammatically clean sentence — if your transcript reads as clean and fluent, stop and re-listen for what you might be smoothing over.
- Silence, mostly-inaudible mumbling, or a response in the wrong language should be transcribed as such (e.g. "[inaudible]" or the actual words in whatever language was spoken), not replaced with a guess at what the prompt expected.

First, transcribe exactly what the learner said under the above rules.

Then, FIRST judge the whole turn for a NATIVE / NEAR-NATIVE profile, because that changes how you read everything else. Signs of a native or near-native speaker: fluent connected speech, natural rhythm and intonation, no groping for words acoustically. When this profile holds:
- Default EVERY word to "good" unless there is a genuine, clearly audible mispronunciation. Native connected speech (vowel reduction, dropped final consonants, linking, contractions) is NOT a pronunciation fault.
- Score the turn 90-100. A fluent native-like speaker must land at the top of the range.

Otherwise (clearly non-native, which is the common case at this proficiency level — do not talk yourself into "native-like" for a hesitant or fragmentary recording), reason word by word based on what you actually hear:
- Crisp, correct articulation → "good".
- Understandable but with a real, audible non-native accent (vowel/consonant quality off, but the word is unambiguous) → "ok". This is the honest, most common verdict for L2 learners — use it freely, don't be shy about it.
- Understood only with effort, strong distracting accent, or a phoneme clearly wrong → "off".
- Mispronounced badly enough that you had to guess the intended word from context, or it's unintelligible → "bad".
- Grammar and word-choice mistakes are NOT pronunciation mistakes. Score only HOW words were pronounced, not whether they were the "right" words to say.

Calibration for turn_score — use the FULL range, do not cluster everyone in the middle, and do NOT default to the same number for every turn — vary it with how strong the accent actually is, even between two turns you'd word-score identically:
- Native / near-native fluent speech: 90-100.
- Clear but accented (mostly "ok"): 72-89.
- Noticeable non-native accent throughout (several "off"): 55-71.
- Accent plus words that were hard to understand: one such word caps the turn at 65; two at 50; three or more at 38; mostly unintelligible below 28.
- A fragmentary, halting, or largely-guessed-at attempt — the common case at A0/A1 on a placement test — belongs well below 38, down to single digits for near-silent or unintelligible attempts. Do not let a short transcript with mostly "good"-looking isolated words pull the score up if the overall attempt was fragmentary and effortful rather than fluent.

Return ONLY JSON, no markdown fences, no commentary outside the JSON:
{"transcript": "<verbatim transcript>", "turn_score": <0-100 integer>, "words": [{"w": "<word, matching the transcript above, in order>", "v": "good|ok|off|bad"}], "summary": "<one short sentence on the main issue, or empty if none>"}`;

// Exported (unlike voxtral.ts's private assess) so dev-test scripts can pass
// systemPrompt overrides for prompt-iteration experiments without touching
// the qwenProvider contract other comparisons rely on.
export async function assess({
  audio,
  contentType,
  langCode,
  context = "",
  clientWpm = 0,
  turnLogId,
  systemPrompt = SYSTEM_PROMPT,
  temperature,
}: PronunciationAssessParams & { systemPrompt?: string; temperature?: number }): Promise<PronunciationResult | null> {
  const processLabel = turnLogId ? assessProcessLabel("EO", turnLogId) : "qwen-judge";
  logServerEvent("eo_request_received", { turnLogId, process: processLabel, provider: "qwen" });

  const langLabel = LANG_LABELS[langCode] ?? "English";
  const format = audioFormat(contentType);
  const base64Audio = Buffer.from(audio).toString("base64");

  const userText =
    `Language the learner is speaking: ${langLabel}.\n` +
    (context ? `The examiner's question they were answering: "${context}"\n` : "") +
    `Listen to the attached audio and assess the pronunciation as instructed.`;

  let parsed: QwenJudgeResult;
  try {
    const raw = await dashscopeChatComplete({
      model: qwenModel(),
      system: systemPrompt,
      base64Audio,
      format,
      userText,
      temperature,
    });
    const cleaned = raw.trim().replace(/^```json\s*|\s*```$/g, "").trim();
    parsed = JSON.parse(cleaned) as QwenJudgeResult;
    if (typeof parsed.turn_score !== "number" || !Array.isArray(parsed.words) || typeof parsed.transcript !== "string") {
      throw new Error("malformed Qwen judge response");
    }
  } catch (e) {
    console.error("[pronunciation] qwen failed:", e);
    logServerEvent("eo_failed", { turnLogId, process: processLabel, provider: "qwen", error: String(e) });
    throw e instanceof Error ? e : new Error(String(e));
  }

  const words = parsed.words.map((w) => {
    const m = VERDICT_MAP[w.v] ?? VERDICT_MAP.ok;
    return { word: w.w, confidence: m.confidence, accuracyScore: m.accuracyScore, errorType: m.errorType };
  });

  const wordAvg = words.length
    ? Math.round(words.reduce((s, w) => s + w.accuracyScore, 0) / words.length)
    : 0;
  const score = Math.max(0, Math.min(100, Math.round(parsed.turn_score), wordAvg + 8));

  console.log(
    `[pronunciation] qwen OK score=${score} verdicts=${parsed.words.map((w) => `${w.w}:${w.v}`).join(" ")}${parsed.summary ? ` — ${parsed.summary}` : ""}`
  );
  logServerEvent("eo_complete", { turnLogId, process: processLabel, provider: "qwen", model: qwenModel(), score });

  return {
    text: parsed.transcript,
    pronunciationScore: score,
    accuracyScore: score,
    wpm: clientWpm,
    words,
    source: "qwen",
  };
}

export const qwenProvider: PronunciationProvider = {
  id: "qwen",
  label: "Qwen3-Omni (direct audio, single call) — dev-test only",
  modelLabel: qwenModel(),
  assess,
};
