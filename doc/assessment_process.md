# Assessment process (A / ET / EO / STT)

How the examiner's replies and the pronunciation/level assessments relate to
each other, and how the end-of-session score card is actually computed. This
follows the 2026-08-12 change that split "answer the user" from "assess how
they did" into separate, non-blocking calls, and the later 2026-08-12 move of
live speech-to-text off Azure onto Mistral (Voxtral) — see "Is Azure still
used?" below for what that did and didn't change. It also reflects the
2026-08-14 switch of EO (pronunciation) back onto Azure + Deepgram + Mistral
judge, reversing the brief 2026-08-11 move to Voxtral-only.

## Full pipeline at a glance

What happens to your speech, and which model touches it — from the moment
you talk to the moment the session is scored and saved.

### Per turn, while the conversation is happening

| Step | What it does | Model | Where |
|---|---|---|---|
| VAD | Detects when you've stopped talking (client-side, no model) | — | `lib/turn-vad.ts` |
| STT | Transcribes the recorded clip, once VAD ends the turn | Mistral Voxtral (transcription endpoint) | `app/api/transcribe/route.ts` |
| ET | Grades the answer from text, sets next difficulty | Mistral (text) | `lib/level-assessment.ts` |
| EO | Grades pronunciation from the recording | Deepgram + Azure evidence, judged by Mistral | `lib/pronunciation/providers/azure-ensemble.ts` |
| A | Writes the examiner's next reply | Mistral (text) | `app/api/chat/route.ts` |
| TTS | Speaks that reply out loud | Voxtral or Azure — see note | `app/api/chat/route.ts` |

Notes:
- STT runs on **all 6 languages** via Voxtral; EO runs on **all 6 languages**
  via the `azure-ensemble` provider (Deepgram verbatim transcript + Azure
  acoustic scores, triangulated by a Mistral judge). EO switched from
  Azure+Deepgram to Voxtral on 2026-08-11, then back to Azure+Deepgram+Mistral
  judge on 2026-08-14 at the client's request; STT switched from the Azure
  Speech SDK to Voxtral on 2026-08-11 and is unaffected by the EO change —
  they're independent capabilities/registries (`lib/stt/registry.ts` vs.
  `lib/pronunciation/registry.ts`).
- STT and EO are two **separate, independent** calls, not one: STT uses
  Mistral's dedicated `/v1/audio/transcriptions` endpoint (fast,
  transcription-only, no judging) because it's on the blocking critical path
  (see "Non-blocking, best-effort" below); EO fans out to Deepgram + Azure in
  parallel, then a Mistral text-completion call judges that evidence — it
  reasons about pronunciation quality, not transcription.
- TTS is split: **Voxtral for English and French**, **Azure for the other
  four** (Dutch-BE, Spanish, Italian, German) — unaffected by the STT/EO
  changes.

### Once the conversation ends

| Step | What it does | Model | Where |
|---|---|---|---|
| CEFR score | Fresh read of the whole transcript | Mistral (text) | `app/api/evaluate/route.ts` |
| Pronunciation score | Averages all of this session's EO scores | none — math only | `lib/pronunciation-rollup.ts` |
| Session save | Stores transcript, audio, and both scores | none | `lib/sessions-service.ts` |

### Is Azure still used?

Yes, on two separate, unrelated paths:
- **TTS for 4 of 6 languages** (Dutch-BE, Spanish, Italian, German) —
  English/French moved to Voxtral on 2026-08-11.
- **EO (pronunciation)**, live again since 2026-08-14, via the
  `azure-ensemble` provider (`lib/pronunciation/providers/azure-ensemble.ts`):
  Azure supplies acoustic per-word scores, Deepgram supplies an independent
  verbatim transcript, and Mistral judges the combined evidence. It briefly
  ran on Voxtral alone (2026-08-11 to 2026-08-14) before the client asked to
  go back; `voxtral` remains registered and available as an on-demand
  comparison run from the admin gear (`LIVE_CONVERSATION_PRONUNCIATION_PROVIDER_ID`
  in `lib/pronunciation-rollup.ts` is the switch — see that file's comment
  for the full history).

What's **not** on Azure: what you're recognized as having said. Live
speech-to-text (the transcript driving ET, A, and chat history) is Voxtral
only, and is a separate capability/registry from EO — see below.

Live speech-to-text — the transcript that drives ET, A, and chat history —
used to run on the Azure Speech SDK's continuous streaming recognizer, which
did double duty as both the transcriber AND the turn-boundary detector (its
segmentation-silence timeout decided when you'd stopped talking, alongside
debounce/continuation-word heuristics). Voxtral has no streaming equivalent —
it's a batch call, not a live one — so that recognizer was replaced with two
separate pieces: a lightweight client-side VAD (`lib/turn-vad.ts`, energy/
silence-based, replaces the turn-boundary-detection half) and a Voxtral
transcription call once VAD ends a turn (`app/api/transcribe/route.ts`,
replaces the transcription half). One consequence: **live partial captions
are gone** — there's no streaming text to show while you're still talking,
just a "…" listening indicator between speech-start and the transcript
arriving.

## The four per-turn processes

A = Answering, ET = Evaluation Transcription, EO = Evaluation Oral,
STT = Speech-To-Text (the transcription itself, distinct from ET's grading
of it).

| Label | What it does | Model | Where |
|---|---|---|---|
| STT{n} | Transcribes the audio answering A{n} — blocking, everything else in the turn depends on this | `MISTRAL_TRANSCRIBE_MODEL` | `app/api/transcribe/route.ts` |
| A{n} | Examiner's n-th reply/question | `MISTRAL_CHAT_MODEL` | `app/api/chat/route.ts` |
| ET{n} | Grades the answer to A{n} from text, sets the rung for A{n+1} | `MISTRAL_CHAT_MODEL` | `lib/level-assessment.ts` |
| EO{n} | Grades pronunciation of the answer to A{n} from audio (Deepgram + Azure evidence, Mistral judge) | `MISTRAL_PRONUNCIATION_MODEL` | `lib/pronunciation/providers/azure-ensemble.ts` |

Model env vars default: `MISTRAL_CHAT_MODEL` falls back to `MISTRAL_MODEL`,
then `mistral-large-latest`; `MISTRAL_PRONUNCIATION_MODEL` falls back to
`MISTRAL_MODEL` (used by EO's judge step, distinct from `MISTRAL_VOXTRAL_MODEL`,
which only the `voxtral` comparison provider uses); `MISTRAL_TRANSCRIBE_MODEL`
falls back to `voxtral-mini-latest` (a distinct, transcription-optimized
model/endpoint — see "Is Azure still used?" above). ET deliberately reuses
the chat model — it's meant to be "basic," not precise.

`A1` is always the opening greeting + A1 warm-up question. `A{N+1}` is the
reply generated in response to the user's N-th answer (wire `turnLogId`
`"turn-N"`). `ET{n}`/`EO{n}` assess that same n-th answer.

Label helpers live in `lib/turn-labels.ts` (`chatProcessLabel`,
`assessProcessLabel`, the latter taking `"ET" | "EO" | "STT"`) and are
attached to every relevant `logServerEvent`/`logClientEvent` call as a
`process` field, so a turn's whole timeline is greppable from
`logs/server-*.log` by turn (`turnLogId`) or by process (`"process":"ET2"`).

## Non-blocking, best-effort — not a pipeline

**A never waits for ET or EO.** When A{n+1} is about to fire, it reads
whatever `currentRungRef` (client-side, `app/page.tsx`) currently holds —
either ET{n}'s completed result, or (if ET{n} hasn't finished yet) whatever
the last completed ET result was, or the "A2" default if none has ever
completed. There is no blocking wait anywhere in this path.

This was a deliberate choice, not an oversight: an earlier version of this
codebase *did* block the next reply on the previous turn's pronunciation-judge
call (`H-02a` in `DEV-PLAN.md`, removed 2026-08-10 specifically because it
made the examiner's reply wait on assessment). Re-blocking A on ET/EO would
reintroduce that same latency pattern — measured at the time to add several
seconds per turn in the worst case (a single Mistral call has been observed
spiking past 11s time-to-first-token; see `logs/server-2026-08-12.log`).

**STT is the one exception — and that's new, not a returned old pattern.**
ET, A, and chat history all need the actual transcript text, so STT{n} is
necessarily blocking: nothing else in the turn can start until it resolves.
This is a direct, accepted consequence of moving STT off Azure's live
streaming recognizer (which delivered text instantly, word by word) onto a
Voxtral batch call (which delivers text only once the whole clip has been
sent and transcribed) — see "Is Azure still used?" above. Using the
dedicated `/v1/audio/transcriptions` endpoint (fast, transcription-only)
rather than a chat-completions call keeps this as small as possible, but
it's still new latency that didn't exist before 2026-08-12 and should be
checked against real `logs/server-*.log` timings (`mistral_request_start`/
`mistral_request_success` for `process` values like `"STT2"`), the same way
the H-02a latency claim above is backed by log evidence, not assumption.

**Firing order, per turn** (`app/page.tsx`, `onSpeechEnd`):
0. VAD (`lib/turn-vad.ts`) detects the user has stopped talking; the turn
   recording is stopped/handed off, and STT (blocking, see above) turns it
   into text — everything below waits on this.
1. STT finalizes the user's answer.
2. **ET fires immediately** — text-only, needs nothing but the transcript, so
   it has no dependency on the recording finishing.
3. **EO fires immediately** too, once the recording promise resolves (same
   moment, in practice) — for turns handled right away. **Exception:** if the
   avatar was still busy and this turn got queued (buffered), EO is deferred
   to flush time instead, because its `turnIndex` (which transcript row to
   attach the score to) isn't known until the turn is actually flushed into
   history — firing early would risk mislabeling a different turn's row. ET
   has no such constraint and always fires immediately, buffered or not.
4. **A{n+1} fires** (immediately for a non-buffered turn; whenever the
   previous turn's flush allows it, for a buffered one) using whatever rung
   `currentRungRef` holds *at that moment* — not waiting on step 2 or 3.

In the common case, ET{n}/EO{n} finish well before A{n+1} is needed at all —
the avatar still has to finish speaking A{n} and the user has to answer, both
of which take longer than a `mistral-small`/`voxtral-small` call. But it's
explicitly best-effort: if they haven't finished, A{n+1} just uses a slightly
stale rung rather than wait.

## What ET actually decides

`lib/level-assessment.ts` asks a small model for one of three verdicts —
`"well"`, `"adequate"`, `"struggled"` — given the question and the answer,
then steps the CEFR ladder (`A1→A2→B1→B2→C1`) up, holds, or down by exactly
one rung (`well`→up, `struggled`→down, `adequate`/unrecognized→hold), clamped
to the ladder ends. This is the same step logic that used to live inline in
the conversation prompt itself; it's just been moved to its own call so A no
longer has to reason about pacing on every single reply.

## The end-of-session score card

Two different axes, computed two different ways — **not symmetric**:

- **CEFR level + dimensions (fluency / vocabulary_grammar / communication):**
  a **brand-new, from-scratch assessment**, not a compilation of anything
  computed per-turn. `app/api/evaluate/route.ts` fires one call
  (`lib/cefr-prompt.ts`'s `CEFR_SYSTEM_PROMPT`) at session end, handing it
  every user turn's raw transcript text concatenated together. It never sees
  ET's per-turn verdicts or rungs — those are consumed live by A and then
  discarded. Even now that ET is a real, structured assessment, the final
  CEFR read is still blind to it.

- **Pronunciation score:** a **compiled average** of the individual per-turn
  EO results, not a fresh listen. `pronunciationAvg`
  (`app/page.tsx`, word-weighted for WPM) averages each turn's own
  `pronunciationScore` from EO. That averaged number is then handed to the
  CEFR call as supporting context (it anchors the fluency dimension via the
  WPM/pronunciation-confidence scale in the prompt) — it does not get its own
  fresh global pass.

So: pronunciation = arithmetic over per-turn EO scores; CEFR level = one
holistic re-read of the whole transcript, independent of any per-turn signal.

## Known limitations

- ET is intentionally "basic" (small model, `verdict` only, no reasoning
  trace) — a pacing signal, not a real assessment. Don't reuse its output as
  evidence anywhere that needs precision (e.g. the score card).
- EO's immediate-fire path only applies to non-buffered turns (see firing
  order above) — buffered turns still wait for flush.
- No live partial captions since the 2026-08-12 STT move — `lib/turn-vad.ts`
  only reports speech-start/speech-end, not interim text, so the UI shows a
  "…" listening indicator instead of growing live text.
- `lib/turn-vad.ts`'s silence/energy thresholds were carried over from an
  earlier, unrelated experiment (the retired `lib/whisper-stt.ts`) as a
  starting point, tuned against a stream with browser noise suppression ON —
  the live conversation's mic stream deliberately runs with noise suppression
  OFF (for pronunciation-assessment fidelity), so these may need re-tuning
  against real background noise.
- The final CEFR call is fully decoupled from ET/EO's per-turn work today.
  Folding ET's turn-by-turn signal into the final score (instead of a
  from-scratch re-read) is a natural future step, not yet done.
- No result caching/versioning: if `MISTRAL_CHAT_MODEL` changes mid-session,
  A and ET both switch models on the next call — there's no pinning per
  session.

## Checking whether a past session would score the same today

After a change to STT, EO, or the CEFR prompt/model, open any existing
session (live or Speechace-imported) in the admin UI (`/admin/[id]`) and
replay it through today's code, piece by piece:

- **STT** (did the transcript itself change?): each user turn has a "Re-run
  STT" button (`components/SttLabPanel.tsx`,
  `app/api/sessions/:id/turns/:turnId/stt-lab`). It re-transcribes that
  turn's stored recording with the live STT provider and diffs it
  word-for-word against the transcript that was actually saved — additions
  underlined green, drops struck through red, a same-words percentage up
  top. Ephemeral (nothing is persisted); this is the one leg the two labs
  below don't touch, since both replay against the frozen stored text, not
  the audio.
- **EO** (pronunciation) and **CEFR** (level/dimensions): the ⚙ "Run full
  evaluation" gear next to the score breakdown
  (`components/FullEvaluationPanel.tsx`) re-runs every registered
  pronunciation provider against every turn's stored audio, and every
  registered eval provider against the stored transcript — fresh, uncached
  calls through today's code. Results land next to the original in the score
  breakdown panel below, tagged "● current" vs the original and colour-coded
  by Δ (`components/ComparisonTable.tsx`).

None of this changes the session's headline score by itself — a conversation
session's headline stays protected (see `FullEvaluationPanel`'s warning
banner); promoting a re-run over it is a separate, explicit action
(`PromoteHeadlineButton`). So this is safe to run on production sessions
purely to compare, without touching what's actually stored.
