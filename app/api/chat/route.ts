import type { ConvLang } from "@/lib/conversation-prompts";
import { buildExaminerPrompt, type BankState } from "@/lib/examiner-prompt";
import { mistralChatModel, mistralComplete, mistralStreamText } from "@/lib/mistral";
import { repairExaminerReply, SPOKEN_SENTENCE_RE } from "@/lib/examiner-guard";
import { logServerEvent } from "@/lib/server-log";
import { getLiveProfile } from "@/lib/test-profiles";
import { profileQuestionReply, withTurnNote } from "@/lib/conversation-prompts";
import type { CefrRung } from "@/lib/cefr-rung";
import { chatProcessLabel } from "@/lib/turn-labels";
import { getProvider as getTtsProvider, isBetaTts, liveTtsProviderId } from "@/lib/tts/registry";

export const runtime = "nodejs";

interface ChatRequest {
  language: ConvLang;
  history: { role: "user" | "assistant"; content: string }[];
  userMessage: string;
  /** H-01 latency-instrumentation id, set by app/page.tsx — echoed into every
   *  log line below so a turn's client + server timeline can be reconstructed
   *  from logs/server-YYYY-MM-DD.log by grepping for the id. */
  turnLogId?: string;
  /** Difficulty rung to target this reply, from app/page.tsx's currentRungRef —
   *  set by ET's most recently COMPLETED result (lib/level-assessment.ts),
   *  best-effort/non-blocking. This call no longer decides its own pacing. */
  rung?: CefrRung;
  /** Bank question ids already offered this session (any rung), from
   *  app/page.tsx's usedQuestionsRef — Track I-03 within-session repeat-avoidance. */
  usedQuestions?: string[];
  /** C1/C2 bank question + follow-up state, from app/page.tsx's bankStateRef (see lib/examiner-prompt.ts). */
  bankState?: BankState;
  /** True for the opening turn ("__START__") — the opener comes from the
   *  warm-up bank (lib/question-bank/warmup.ts). */
  isStart?: boolean;
  /** Life domain to steer AWAY from this turn — set by app/page.tsx once TT
   *  (lib/topic-tracking.ts) has tagged the same domain 2 turns running,
   *  best-effort/non-blocking, same tolerance as `rung` above. */
  avoidDomain?: string;
  /** Concrete domain the next question must be about — picked client-side (lib/topic-domain.ts pickSwitchDomain) when avoidDomain is set. */
  switchToDomain?: string;
  /** The speaker didn't understand the last question — "Je ne comprends pas"
   *  button or a detected phrase (lib/comprehension.ts). Rephrase it simpler. */
  clarify?: boolean;
  /** Consecutive "didn't understand" on this question, this one included — from CLARIFY_GIVE_UP_ATTEMPT the question is dropped instead (lib/examiner-prompt.ts). */
  clarifyAttempt?: number;
  /** Client profile id of this test (`?profile=` on the link, lib/test-profiles.ts). */
  profile?: string;
  /** The end of the test is near — missing profile questions are asked even out of their level range. */
  profileUrgent?: boolean;
}

// Speaking-rate presets. The conversation opens slow so low-level listeners
// can follow; it switches to the natural rate once the target rung (from the
// request body, set by ET — see ChatRequest.rung above) reaches B1+. Product/
// pedagogy decision, not provider-specific — only lib/tts/providers/azure.ts
// actually applies it (Mistral's endpoint rejects a speed param entirely).
const SLOW_RATE = "-16%";
const NORMAL_RATE = "-3%";

/**
 * POST /api/chat
 * SSE stream:  event: text  → { delta } token delta (real-time, unblocked —
 *                              the client logs it for latency but no longer
 *                              renders it live; see event: audio below)
 *              event: audio → { text, audio } — text is the sentence this
 *                              chunk was synthesized from, audio is base64
 *                              PCM (one full sentence per event). Paired so
 *                              the client can reveal the caption in step with
 *                              actual playback instead of the raw token
 *                              stream, which typically finishes well before
 *                              any audio is ready.
 *              event: done  → { fullText, usedQuestions, bankState }
 *              event: error → { stage, message }
 *
 * Latency strategy:
 *  1. TTS is fired immediately on each sentence boundary — NO await inside the LLM loop.
 *  2. All TTS requests run in parallel with LLM generation.
 *  3. The TTS response is streamed (chunks forwarded as they arrive) — Gradium
 *     for en/fr/es/de/nl-NL, Azure for nl-BE/it (see lib/tts/registry.ts's
 *     liveTtsProviderId).
 *  4. By the time the LLM finishes, sentence-1 TTS is already done or nearly done.
 */
export async function POST(req: Request) {
  const { language, history, userMessage, turnLogId, rung, usedQuestions, bankState, isStart, avoidDomain, switchToDomain, clarify, clarifyAttempt, profile: profileId, profileUrgent } =
    (await req.json()) as ChatRequest;
  const profile = profileId ? await getLiveProfile(profileId) : null;
  const logId = turnLogId ?? "unknown";
  const process = chatProcessLabel(logId);
  const previousReply = [...(history ?? [])].reverse().find((m) => m.role === "assistant")?.content ?? "";
  const { system, turnNote, targetRung, updatedUsedQuestions, bankState: updatedBankState, profileRemaining, profileQuestion } = buildExaminerPrompt({
    language, rung, usedQuestions, bankState, isStart, isEnd: userMessage === "__END__", avoidDomain, switchToDomain, clarify, clarifyAttempt, profile, profileUrgent, previousReply,
  });
  // The turn's instruction goes last, after the speaker's message (lib/conversation-prompts.ts, three layers).
  const modelMessages = [...(history ?? []).map(({ role, content }) => ({ role, content })), { role: "user" as const, content: withTurnNote(userMessage, turnNote) }];
  const requestReceivedAt = Date.now();
  logServerEvent("chat_request_received", {
    turnLogId: logId, process, targetRung, ...(clarify ? { clarify: true, clarifyAttempt: clarifyAttempt ?? 1 } : {}),
    ...(updatedBankState.currentId ? { bankQuestionId: updatedBankState.currentId, bankFollowUp: updatedBankState.followUpDone === true } : {}),
    ...(profile ? { profile: profile.id, profileQuestionId: updatedBankState.profileCurrent ?? null, profileRemaining, profileUrgent: profileUrgent === true } : {}),
  });
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: string) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));

      let fullText = "";
      let pending = "";
      // H-01 latency instrumentation — each logged once per turn.
      let loggedFirstToken = false;
      let loggedFirstTtsFired = false;
      let loggedFirstTtsReady = false;

      // Speaking rate for this reply, derived directly from the target rung —
      // no more parsing a self-reported tag out of the model's own output.
      const rate = targetRung === "A1" || targetRung === "A2" ? SLOW_RATE : NORMAL_RATE;

      // Each entry pairs the sentence text with a Promise that resolves to its
      // streaming TTS reader (or null) — the text travels with its audio so
      // the client can reveal the caption in step with playback instead of
      // as soon as it streams in from the LLM (see the "audio" event below).
      // Promises are pushed immediately when a sentence boundary is hit — no await.
      const ttsQueue: { text: string; readerPromise: Promise<ReadableStreamDefaultReader<Uint8Array> | null> }[] = [];

      // Gradium for en/fr/es/de and nl-NL (beta voices), Azure for nl-BE/it
      // (Gradium doesn't cover them) — see lib/tts/registry.ts's
      // liveTtsProviderId. A beta failure falls back to Azure so the
      // sentence isn't silently dropped.
      const ttsProvider = getTtsProvider(liveTtsProviderId(language));
      const betaTts = isBetaTts(language);
      const fireTTS = (sentence: string) => {
        const params = { text: sentence, language, rate, turnLogId: logId };
        const primary = ttsProvider.synthesize(params);
        ttsQueue.push({
          text: sentence,
          readerPromise: betaTts
            ? primary.catch(() => null).then((r) => r ?? getTtsProvider("azure").synthesize(params))
            : primary,
        });
      };

      // Forward text: to the caption channel, accumulate into fullText, and
      // fire TTS on each complete sentence.
      const emit = (chunk: string) => {
        if (!chunk) return;
        fullText += chunk;
        pending += chunk;
        send("text", JSON.stringify({ delta: chunk }));
        // Requires at least 2 consecutive letters somewhere before the
        // terminator, not just the bare `[.!?…]` — otherwise a stray
        // numbered/lettered marker ("1.") or leftover punctuation with no
        // real word content gets treated as its own "sentence" and fired to
        // TTS on its own. Voxtral (lib/tts/providers/mistral.ts) doesn't
        // fail gracefully on that kind of degenerate input — it hallucinates
        // unintelligible babble, which plays right before the real reply
        // with no meaningful caption to show for it (the caption is the
        // fragment's own text, e.g. "1.", easy to miss entirely).
        let m;
        while ((m = pending.match(SPOKEN_SENTENCE_RE))) {
          if (!loggedFirstTtsFired) {
            loggedFirstTtsFired = true;
            logServerEvent("chat_first_tts_fired", { turnLogId: logId, process });
          }
          fireTTS(m[1]);
          pending = pending.slice(m[0].length);
        }
      };

      try {
        if (profileQuestion) {
          // Client-profile turn: the question is spoken exactly as the client wrote it, no model call.
          const lastExaminer = [...history].reverse().find((m) => m.role === "assistant")?.content ?? "";
          emit(profileQuestionReply(language, profileQuestion, lastExaminer));
        } else {
          const llmStream = mistralStreamText({
            model: mistralChatModel(),
            system,
            messages: modelMessages,
            maxTokens: 300,
            context: process,
          });

          for await (const piece of llmStream) {
            if (!loggedFirstToken) {
              loggedFirstToken = true;
              logServerEvent("chat_first_llm_token", { turnLogId: logId, process });
            }
            emit(piece);
          }

          // The last sentence (normally the question) is still unspoken here: a reply with
          // no question, or the same question again, gets one corrective regeneration
          // before it is spoken (lib/examiner-guard.ts).
          if (userMessage !== "__END__") {
            const repaired = await repairExaminerReply({
              language,
              fullText,
              pending,
              previousExaminerTurns: history.filter((m) => m.role === "assistant").map((m) => m.content),
              regenerate: (direction) =>
                mistralComplete({
                  model: mistralChatModel(),
                  system: system + direction,
                  messages: modelMessages,
                  maxTokens: 300,
                  context: `${process}:repair`,
                }),
            });
            if (repaired) {
              logServerEvent("chat_reply_repaired", { turnLogId: logId, process, problem: repaired.problem, before: fullText, after: repaired.fullText });
              fullText = repaired.fullText;
              pending = repaired.pending;
            }
          }
        }

        if (pending.trim()) {
          if (!loggedFirstTtsFired) {
            loggedFirstTtsFired = true;
            logServerEvent("chat_first_tts_fired", { turnLogId: logId, process });
          }
          fireTTS(pending);
        }
      } catch (e) {
        send("error", JSON.stringify({ stage: "llm", message: String(e) }));
      }

      // Drain TTS readers in order. Buffer the entire PCM response for each
      // sentence and send it as ONE audio event. Sending many small events
      // (one per Azure read() chunk) creates arbitrary waveform boundaries
      // mid-sentence which cause audible clicks and static at the player.
      // Since TTS runs in parallel with the LLM, the full sentence audio is
      // typically already available by the time we reach this drain phase —
      // buffering adds no meaningful latency.
      for (const { text: sentenceText, readerPromise } of ttsQueue) {
        const reader = await readerPromise;
        if (!loggedFirstTtsReady) {
          loggedFirstTtsReady = true;
          logServerEvent("chat_first_tts_ready", { turnLogId: logId, process, ok: !!reader });
        }
        if (!reader) continue;
        try {
          const chunks: Buffer[] = [];
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            if (value?.length) chunks.push(Buffer.from(value));
          }
          if (chunks.length) {
            send("audio", JSON.stringify({ text: sentenceText, audio: Buffer.concat(chunks).toString("base64") }));
          }
        } finally {
          reader.releaseLock();
        }
      }

      // Only send "done" (which the client appends to conversation history as
      // the assistant's turn) when something was actually generated. Sending
      // it unconditionally — even after the LLM call failed outright — used
      // to push an empty-content assistant message into history; Mistral then
      // rejects EVERY subsequent turn with 400 "Assistant message must have
      // either content or tool_calls, but not none", permanently breaking the
      // rest of the session over one transient failure.
      if (fullText.trim()) {
        send("done", JSON.stringify({ fullText, usedQuestions: updatedUsedQuestions, bankState: updatedBankState, profileRemaining }));
      }
      logServerEvent("chat_stream_done", { turnLogId: logId, process, durationMs: Date.now() - requestReceivedAt });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
