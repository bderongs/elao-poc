import { getSystemPrompt, buildQuestionBank, type ConvLang } from "@/lib/conversation-prompts";
import { mistralChatModel, mistralStreamText } from "@/lib/mistral";
import { logServerEvent } from "@/lib/server-log";
import { isCefrRung, type CefrRung } from "@/lib/cefr-rung";
import { chatProcessLabel } from "@/lib/turn-labels";
import { getProvider as getTtsProvider, LIVE_TTS_PROVIDER_BY_LANG } from "@/lib/tts/registry";
import { OPENER_DOMAINS, isTopicDomain } from "@/lib/topic-domain";

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
  /** Bank question strings already offered this session (any rung), from
   *  app/page.tsx's usedQuestionsRef — Track I-03 within-session repeat-avoidance. */
  usedQuestions?: string[];
  /** True for the opening turn ("__START__") — triggers a random openerDomain
   *  pick below (see lib/topic-domain.ts) instead of letting the model default
   *  to "where are you from" every session. */
  isStart?: boolean;
  /** Life domain to steer AWAY from this turn — set by app/page.tsx once TT
   *  (lib/topic-tracking.ts) has tagged the same domain 2 turns running,
   *  best-effort/non-blocking, same tolerance as `rung` above. */
  avoidDomain?: string;
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
 *              event: done  → { fullText, usedQuestions }
 *              event: error → { stage, message }
 *
 * Latency strategy:
 *  1. TTS is fired immediately on each sentence boundary — NO await inside Claude loop.
 *  2. All TTS requests run in parallel with Claude generation.
 *  3. The TTS response is streamed (chunks forwarded as they arrive) — Azure
 *     for nl-BE/es/it/de, Mistral (Voxtral) for en/fr (see
 *     lib/tts/registry.ts's LIVE_TTS_PROVIDER_BY_LANG).
 *  4. By the time Claude finishes, sentence-1 TTS is already done or nearly done.
 */
export async function POST(req: Request) {
  const { language, history, userMessage, turnLogId, rung, usedQuestions, isStart, avoidDomain } =
    (await req.json()) as ChatRequest;
  const logId = turnLogId ?? "unknown";
  const process = chatProcessLabel(logId);
  const targetRung: CefrRung = isCefrRung(rung) ? rung : "A2";
  // Picked fresh per session rather than left to the model's own "vary it"
  // judgment — live sessions showed the model defaulting to "where are you
  // from" as the opener nearly every time regardless of that instruction.
  const openerDomain = isStart ? OPENER_DOMAINS[Math.floor(Math.random() * OPENER_DOMAINS.length)] : undefined;
  const promptOpts = {
    ...(isTopicDomain(avoidDomain) ? { avoidDomain } : {}),
    ...(openerDomain ? { openerDomain } : {}),
  };
  // Narrow the bank to just this turn's target rung, and track which strings
  // have already been offered this session — Track I-03. Called once, here,
  // so the updatedUsedQuestions echoed back in "done" matches exactly what
  // the LLM was shown (calling buildQuestionBank twice would desync them).
  const { bankText, updatedUsedQuestions } = buildQuestionBank(targetRung, usedQuestions ?? []);
  const requestReceivedAt = Date.now();
  logServerEvent("chat_request_received", { turnLogId: logId, process, targetRung });
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

      // Mistral for en/fr (preset voices exist), Azure for everything else —
      // see lib/tts/registry.ts's LIVE_TTS_PROVIDER_BY_LANG.
      const fireTTS = (sentence: string) =>
        ttsQueue.push({
          text: sentence,
          readerPromise: getTtsProvider(LIVE_TTS_PROVIDER_BY_LANG[language]).synthesize({
            text: sentence, language, rate, turnLogId: logId,
          }),
        });

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
        while ((m = pending.match(/^([\s\S]*?[A-Za-zÀ-ÖØ-öø-ÿ]{2}[\s\S]*?[.!?…])\s/))) {
          if (!loggedFirstTtsFired) {
            loggedFirstTtsFired = true;
            logServerEvent("chat_first_tts_fired", { turnLogId: logId, process });
          }
          fireTTS(m[1]);
          pending = pending.slice(m[0].length);
        }
      };

      try {
        const llmStream = mistralStreamText({
          model: mistralChatModel(),
          system: getSystemPrompt(language, targetRung, bankText, promptOpts),
          messages: [
            ...history.map(({ role, content }) => ({ role, content })),
            { role: "user", content: userMessage },
          ],
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
      // Since TTS runs in parallel with Claude, the full sentence audio is
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
        send("done", JSON.stringify({ fullText, usedQuestions: updatedUsedQuestions }));
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
