# Client feedback round — dev plan (2026-09-21)

Status (end of 2026-09-21): **P, Q, S, U, T done; two extra fixes found while testing (W) done; V and R analysed but not built; R deliberately parked.** Everything is in the working tree, **uncommitted**, type-checks, and has had only light testing (see §What still needs doing).

Source: the client's 7 remarks after testing the app. Task IDs use tracks **P–W** (Track O was the last one in `DEV-PLAN.md`). Fold them into `DEV-PLAN.md` §M8 or a new milestone once prioritised.

Items marked **⚠ finding** contain something the client's remark doesn't say but the code or the data shows.

## Summary

| Track | Client remark | Status |
|-------|---------------|--------|
| P | Every avatar should be called Léa | ✅ done (spoken smoke test per language still open) |
| Q | Show the end-of-session feedback in admin session reports | ✅ done |
| R | Filter background noise / coughs | ⏸ analysed, **parked by decision** — nothing built |
| S | More natural acknowledgements / transitions (no English "topic switch required now") | ✅ done (+ topic-switch enforcement, see W) — native review of the lists open |
| T | All sessions visible in admin | ✅ done — sessions now saved incrementally, unfinished ones shown (migration applied — single Supabase project) |
| U | "Votre niveau en 3 minutes" instead of "Trois questions" | ✅ done |
| V | Let a native reach C2 | 🔎 analysed with real data; proposal written, **not built** |
| W | Bugs found in the 2026-09-21 native test session | ✅ pronunciation-average bug fixed; ✅ topic-switch enforcement rebuilt |

---

## Track P — Avatar name is Léa in every language ✅

**Ask:** "Ask each avatar to call itself Léa (works in FR, not in the other languages)."

**Cause:** `getSystemPrompt()` gave each language its own persona (Léa fr, Emma nl-BE, Sofía es, Giulia it, Anna de, Alex en) and the opening rule used a `[first name]` placeholder.

**Done**
- [x] **P-01/P-02** New `AVATAR_NAME` constant in `lib/session-config.ts`; all 6 prompts use it for the persona and for the introduction ("je m'appelle Léa", "ik ben Léa", "me llamo Léa", "mi chiamo Léa", "ich heiße Léa", "my name is Léa") instead of the placeholder.
- [x] **P-03** No other hard-coded persona name found in `lib/`, `app/`, `components/`. The FR UI copy still has the literal "Léa" (FR-only screens) — acceptable.
- [x] **P-04** Checked every Azure TTS voice (`lib/tts/providers/azure.ts`): all female, so no name/voice mismatch.
- [x] **P-05** (checked 2026-10-05) Spoken smoke test: one session per language, confirm the intro says "Léa".

---

## Track Q — End-of-session feedback in admin reports ✅

**Ask:** "Bring into the session reports (admin access) the feedback given at the end of the session — strengths and weaknesses."

**Cause:** the admin detail page called `CefrPanel` with `showDetails={false}`; the candidate screen showed strengths/areas/errors/summary but capped at 3/2/2.

**Done**
- [x] **Q-01/Q-02** `CefrPanel` gets a `showAllDetails` prop (uncapped lists); the admin detail page uses it, so strengths, areas to improve, notable errors and summary are visible in full. Candidate screen unchanged.
- [x] **Q-03** Nothing to do — `cefrResult` already falls back to `session_evaluations` for upload/Speechace sessions.
- [ ] **Q-04** (optional, skipped) one-line strengths/weaknesses preview in the admin list.

**Assumption to confirm with the client:** "feedback given at the end of the session" = the written evaluation (not the avatar's spoken closing sentence).

---

## Track R — Background noise / coughs ⏸ parked

**Ask:** "See if there's a way to filter background noise (or coughing) so it doesn't disturb the recordings." Clarified by Baptiste: **do not suppress the cough itself** — the goal is only that it must not be assessed as "not answering correctly".

**What happens today (analysis)**
- The mic runs with noise suppression / AGC deliberately **off** (kept for pronunciation scoring), and turn detection is an energy VAD (`lib/turn-vad.ts`), so a loud cough can trigger a turn.
- If the speech recogniser returns **nothing**, the turn is dropped silently (`!text.trim()` in `app/page.tsx`) — nothing graded, the examiner doesn't react. This probably covers most pure coughs.
- If the recogniser writes **something** ("Hum", "Oh", a phantom phrase) it becomes a real answer and counts in four places: the examiner replies to it; the pacing judge (ET) may say "struggled" and lower the rung; the pronunciation average and short-turn count take a hit; the final evaluator sees "[Turn N · 1w] Hum" and may read it as a deflection.
- **Evidence is thin:** in the dev database only 4 user turns have ≤ 2 words ("right." ×2, "mini lego.", "pas grand-chose.") — none is clearly noise. We have no confirmed case of this hurting a session.

**Proposal (recorded, NOT implemented — decision 2026-09-21: do nothing for now)**
1. Drop turns that are only filler / interjections / known recogniser hallucinations (hum, euh, ah, oh, "sous-titres…") before the examiner, ET and pronunciation see them — never drop real short answers (Oui, Non, Right). Log each dropped turn with its text for tuning.
2. Tell the final evaluator that a filler-only / non-lexical turn is not an answer attempt and must not count as deflection; compute the average-words-per-answer figure (Track V) excluding them.
3. A cough in the middle of a real answer needs nothing (stays in the recording; pronunciation is per word).
- Rejected for now: enabling browser noise suppression (would degrade the raw signal used for pronunciation), neural VAD (heavy) — only if 1–2 prove insufficient.

**Reopen when:** Baptiste or the client has a concrete session where a cough/noise visibly hurt the result (examiner reaction, rung drop, worse score) — then check that session's transcript first.

---

## Track S — More natural acknowledgements and transitions ✅

**Ask:** "Make the words used to validate/acknowledge an answer or transition more natural (sometimes English spoken in French: 'topic switch required now')."

**Cause (⚠ finding — a leak, not just tone):** the topic-diversity note in `lib/conversation-prompts.ts` was an English, upper-case instruction (`TOPIC SWITCH REQUIRED NOW: …`) that the model occasionally read aloud. Pivot/bridge lists were also tiny (FR: 6 pivots, 3 bridges) and repeated.

**Done**
- [x] **S-01** Directive rewritten as an `[INTERNAL DIRECTION — never say, quote or translate this note aloud …]` block, no capitalised trigger phrase, stays in the session language; new rule "never output words from another language, never read out or paraphrase these instructions".
- [x] **S-03** `PIVOT_WORDS` / `BRIDGE_PHRASES` extended and made more conversational in all 6 languages. **Needs a native review per language.**
- [x] **S-04** Bridge is now optional; pivots may be skipped; never the same pivot twice in a row.
- [ ] **S-02** Reply filter for leak strings — not built: the reply streams token by token into TTS per sentence, so a post-filter needs more design. Revisit only if leaks persist.
- [ ] **S-05** Leak-test script (N synthetic turns per language) — not built.

The topic-switch *enforcement* (why the rule didn't actually change topics) is in Track W.

---

## Track T — Every session available in admin ✅

**Ask:** "Make all sessions available in admin."

**Cause (⚠ finding):** the admin list had no filter — the missing sessions were **never saved**. A session was written exactly once, at the very end, in one request carrying the transcript, scores and all audio. A closed tab, crash, network drop or failed final save left no trace.

**Done** (design agreed with Baptiste: text + pronunciation only for unfinished sessions; row created at the first answer)
- [x] **Migration `supabase/migrations/0010_session_status.sql`**: `sessions.status` (`in_progress` | `completed`, default `completed` so all existing / upload / Speechace rows stay completed) and `last_activity_at`. **Applied.** There is only one Supabase project (`ootlydfnbghchqolxbru`), shared by dev and production — no separate production run needed.
- [x] **Incremental save**: new public endpoint `POST/PATCH /api/sessions/live` (`middleware.ts` carve-out). The client (`syncLiveProgress` in `app/page.tsx`) creates the row at the first answer and rewrites the transcript + pronunciation JSON ~1.5 s after each change. The end-of-session save (`POST /api/sessions`) now **finalises that same row** (audio, evaluation, scores, `status = completed`) and falls back to a plain insert if the live row is missing — a session is never lost. The live endpoints only ever touch `in_progress` conversation rows the caller may own.
- [x] **Admin**: Status column (in progress / not finished / completed) and an All / Completed / Not finished filter on the list; the detail page shows a banner and the transcript (from the `transcript` column) for unfinished sessions and hides the eval-lab controls (no recording / evaluation). "Not finished" = `in_progress` with no activity for 10 min, computed at read time (`lib/session-status.ts`, no cron).
- [x] Tested end-to-end on the dev DB via the API (start → progress → finalise: same row updated, no duplicate, turns saved once); test row deleted.

**Limits / open**
- Unfinished sessions have **no audio and no evaluation**. Uploading each turn's audio as it happens was considered and deferred (extra upload per answer).
- Someone who opens the page and leaves before the first answer creates no row (by design).
- [x] (checked 2026-10-05) Live browser test: start a session, answer once or twice, close the tab, check `/admin` (should show "in progress", then "not finished" after 10 min).
- [ ] Old T-01 (ask the client for a concrete missing session) is no longer needed to *fix* this, but useful to confirm it was the cause.
- Optional later: search/filter by user/language/date, page-size selector, total-vs-visible count (old T-03/T-04).

---

## Track U — "Votre niveau en 3 minutes" ✅

**Ask:** replace "Trois questions" (the avatar asks more) with "Votre niveau en 3 minutes" (later 5 minutes); adapt other mentions.

**Done**
- [x] **U-01** Landing headline is now "Votre niveau en {n} minutes"; landing subtitle uses the constant; the "X questions sur 3 terminées" line on the thinking screen was removed (it now just says "Vous vous en sortez bien.").
- [x] **U-02** New `SESSION_DURATION_MINUTES` / `SESSION_DURATION_SECONDS` in `lib/session-config.ts` drives the timer, progress bar, landing copy and the "about N minutes" line in all 6 prompts — moving to 5 minutes is a one-line change.
- [x] **U-03** `doc/new_design/README.md` updated (`SCOPE.md` needed no change).
- [ ] **U-04** Non-FR UI copy: not checked (landing copy appears FR-only).

**Heads-up for the 5-minute version:** `lib/session-cost.ts` (`AVG_SESSION` turns/words), the topic-diversity thresholds (Track I) and the cost estimates still assume ~3 minutes and should read from the same constant. `doc/new_design/ELAO Speaking 1a.dc.html` (design source) still contains the old wording.

---

## Track V — Let a native speaker reach C2 🔎 analysed, not built

**Ask:** "See how to obtain a C2 for a native: introduce a complementary metric such as the average number of words per answer, which would influence fluency (or be an extra axis) + award a bonus if 2 of the 4 axes are ≥ 9."

### Findings (real data, dev DB, 47 live sessions + Baptiste's own French sessions)

1. **The bonus already exists**: `computeCompositeCefrScore` (`lib/cefr-score.ts`) applies **+5 % (×1.05) when ≥ 2 of the 4 axes are ≥ 9**; C2 needs a composite ≥ 90.
2. **No session in the data is C2.** Baptiste's two best French sessions (09-17) have axes 9/8/9 + pronunciation 9.5, LLM base 82 → ×1.05 = 86 → **C1+**, 4 points short.
3. **Words per answer does not separate the top levels**: it plateaus around 30 from B2 upward, and the one C1+ session had shorter answers (19.5). As a fluency *booster* it would change nothing and could penalise a concise native. It is a good "not a beginner" signal → better used as a **gate**.
4. **Fluency is already saturated**: any rate ≥ 130 WPM forces fluency ≥ 9 (`FLUENCY_WPM_HARD_BOUNDARIES`), so it is 9.0 from C1 upward — it can't discriminate at the top. Averaging the axes would therefore inflate weaker candidates too.
5. **The LLM's holistic `score_percent` is the noisy part**: identical 9/8/9 axes gave 82 in two sessions and 78 in another; the axis mean would be ~87–89.
6. **Vocabulary/grammar is capped at 8 for a native**: the evaluator flags likely recognition errors ("s'allader", "un suite", "de bons buts") as speaker errors although its own prompt says to dismiss them.
7. **Confidence** (`high/medium/low` from the evaluator, tracks session length: high ≈ 192 s / 8 answers, low ≈ 62 s / 2 answers) is only a label — **it is not used in scoring**, and 30–60 s sessions with 2–3 answers still get a level such as B2+. Decision: **set aside for now**.

### Proposal (not built — to do after more test sessions)
- **C2 floor of 90** when **≥ 3 of 4 axes are ≥ 9, no axis < 8, ≥ 5 answers and ≥ ~20 words per answer**. On the four French sessions checked: both of Baptiste's best sessions become C2; the other two don't move; B1–C1 outcomes otherwise unchanged. (Calibrated on only two sessions — needs more.)
- Needs `answer count` and `average words per answer` stored with the evaluation (or derived from `session_turns`).
- Tighten the evaluator: enforce the "recognition errors" rule for fluent, high-pronunciation speakers (don't list phonetic-looking errors, don't score vocabulary/grammar below 9 for them); fix the stale "all five dimensions" wording in the C2 description; bump `CEFR_PROMPT_VERSION` if the prompt changes.
- Show the "+5 % excellence bonus" in `CefrPanel` / admin breakdown so the client can see it.
- Build an **offline replay script** that runs every stored session through the old and new formulas and lists which sessions change level — required before shipping (no B1–C1 regression).
- [ ] Baptiste to record 3–4 more French sessions (incl. concise answers) and the client to supply one strong **non-native** control, then calibrate.
- ✅ **Activated 2026-10-08 (Baptiste's call): axis-mean base + C2 floor.** `lib/cefr-score.ts` now holds the rules as data (`SCORING_RULES`) and the engine (`scoreWithRules`); `computeCompositeCefrScore` runs it, and the analysis replay (AB-03) runs the same engine. Score = mean of the 4 axes ×10 → +5 % if ≥ 2 axes ≥ 9 → **C2 floor 90** if ≥ 3 axes ≥ 9, none < 8, ≥ 5 answers, ≥ 20 words/answer. Answer count and mean length are stamped on each new evaluation (`answer_count`, `words_per_answer`), so **the floor only applies to sessions evaluated from now on**. **Heads-up:** the score is computed on read, so axis-mean changes how every stored session is *displayed* (replay vs the old base: 42 of 59 move, 41 up, 9 by more than two steps — mostly weaker candidates rising, as finding 4 predicted). Stored `cefr_level` / `global_score` columns and callbacks already sent keep the old values. Watch the first beta sessions; revert with `baseScore: "llm"` in `SCORING_RULES`. `/admin/scoring` text updated.

### Decisions taken on related ideas
- **Send the questions / rung path to the evaluator: not now.** The questions *are* stored (`session_turns`, assistant rows) but only user turns are sent to the evaluator; the **rung per turn is not stored anywhere** (only in local log files `et_result_received` and the debug panel). Feeding the pacing judge's verdicts into the final score could pass on its generosity (three "well" verdicts took Baptiste from B1 to C2); if wanted later, send only the question next to each answer and store the rung purely for auditing.
- **No hand-written C2 question bank.** Baptiste considers the current C2 guidelines good. The concern is instead level *detection* speed (below).

### Level-promotion detection (analysis, not built)
- Today the pacing judge (ET, `lib/level-assessment.ts`) returns well/adequate/struggled and "well" = **+1 rung** (`step_size` = 1 in every language). "Well" is judged **relative to the current rung** ("developed beyond one clause"), so a perfect answer to an easy question earns the same +1 as a merely good one. French starts at A2 (setting changed 2026-09-17): first C2 question is the 5th. The judge also runs non-blocking, so its result may land after the next question was already generated.
- **Proposed:** the judge also estimates the CEFR level the answer itself demonstrates and jumps ≥ 2 rungs when the answer is clearly above the current one, **guarded by evidence** (≥ ~20 words computed in code, subordination/idiom), optionally waiting ~400 ms for the judge on the first 2–3 turns. Quick no-code stopgap (not recommended): `step_size = 2` in admin (also drops 2 rungs on a bad answer). Don't just start French at B1 (weaker candidates lose turns coming down).
- Validate with the same offline replay over stored sessions (your sessions must jump early; weaker ones must not).

---

## Track W — Findings from Baptiste's native test session (2026-09-21) ✅

Baptiste ran a French session, reached C2 in the debug panel for 3 answers, but the final result was C1 (LLM: B2+ 78, axes 9/8/9, ×1.05 → 82). Investigation found several causes; two bugs were fixed.

**Why C2 rung ≠ C2 result**
- The rung is only a pacing signal; the final evaluator sees only the user's answers (not the questions/rung). The judge is generous: only 2 questions were truly at C2 level.
- The answers to the hardest questions were weak: the C2 question ("un argument économique précis pour convaincre un ami de déménager à Marseille") required facts Baptiste had just said they lacked, and the answer hedged.
- Vocabulary/grammar was capped at 8 by recognition errors counted as speaker errors (see Track V finding 6).

**Bug 1 — pronunciation average was wrong ✅ fixed.** Per-answer scores were 93/92/96/96/96/94 (avg 94.5) but the session stored 78.8: the **last answer counted as 0**. Each turn first gets a pass-1 placeholder (score 0, no words) that pass 2 overwrites; the last answer is spoken right before the closing, so the session ended before its real score arrived and the average included the placeholder. It also fed a wrong "pronunciation 79/100" to the evaluator and would have broken a "3 axes ≥ 9" rule.
- [x] `app/page.tsx`: average computed by a pure function that ignores placeholders (`isPlaceholderPronunciation`, WPM still uses all turns); `endSession` waits (≤ 10 s) for in-flight pass-2 calls (`pronunciationInFlightRef`) before evaluating/saving; the recomputed average is what is sent to the evaluator and saved.

**Bug 2 — the topic-change rule didn't change topic ✅ rebuilt.** The streak rule (2) did fire (streak reached 6, every question classified `home_city`), but the model changed the wording, not the subject ("Passons à autre chose. … choisir une autre ville en France" is still the home/city domain), the C2 examples are all follow-ups on the last answer (so "go deeper" beat "leave the topic"), and the rule only said what to avoid.
- [x] `pickSwitchDomain` + `SWITCH_SEEDS` (`lib/topic-domain.ts`): once the streak caps, the client picks a concrete **unvisited target domain** (tracked in `visitedDomainsRef`) and sends `switchToDomain`; the prompt names it with a seed idea (everyday seeds A1–B2, abstract standalone seeds C1/C2) and lists "another city / neighbourhood / reasons for living there" as the same subject.
- [x] C2 examples are now marked as follow-ups to use only while staying on a developed subject; opening a new subject requires a standalone abstract question.
- [x] New knowledge rule: ask only what any adult can answer from experience or opinion; if the speaker says they don't know something, drop it (would have prevented the "argument économique" question).
- Baptiste's live check: "it seems to work". No hard block if the model still ignores it — the streak stays high and a new target is picked next turn.

---

## What still needs doing

1. **Commit** the working tree (nothing is committed yet).
2. ~~Run migration 0010 on production~~ — not needed: single Supabase project for dev and prod, already applied.
3. Live checks: unfinished-session flow (Track T), spoken "Léa" in each language (P-05), native review of pivot/bridge lists (Track S).
4. **Track V** when ready: more native sessions + a non-native control → offline replay script → C2 floor rule, evaluator tightening, promotion-detection change.
5. **Track R** stays parked until a concrete cough/noise case shows up.
6. Client questions still open: end-of-session feedback meaning (Q), missing-session sample to confirm the cause (T), native review (S), words-per-answer as gate vs axis and whether they know the +5 % bonus exists (V), go-live date of the 5-minute version (U).

## Files touched

`lib/session-config.ts` (new) · `lib/session-status.ts` (new) · `app/api/sessions/live/route.ts` (new) · `supabase/migrations/0010_session_status.sql` (new) · `lib/conversation-prompts.ts` · `lib/topic-domain.ts` · `app/api/chat/route.ts` · `app/page.tsx` · `lib/sessions-service.ts` · `lib/types.ts` · `middleware.ts` · `app/admin/(dashboard)/page.tsx` · `app/admin/(dashboard)/[id]/page.tsx` · `components/ScoreDisplay.tsx` · `doc/new_design/README.md`

---
---

# Beta-tester round — dev plan (2026-09-28)

Source: the client's beta-tester feedback (EN/ES/IT/NL/DE/FR tests of 2026-09-24/25) plus the client's own opinions. New tracks **X–AB**. Items marked **⚠ finding** come from the code or the data, not from the feedback itself.

## Summary

| Track | Feedback | Status |
|-------|----------|--------|
| X | Finished sessions shown as "not finished" (and results missing) | ✅ fixed — root cause found (upload size limit), live check on Vercel pending |
| Y | Léa doesn't notice the end of an answer, freezes, cuts testers off, stays stuck on a question | 🟡 partly done (freeze + "Je ne comprends pas"); silence timing still to do |
| Z | Transcription wrong in DE/NL/FR, place names not recognised | 🟡 VAD audio fix done; Gradium tried and dropped on accuracy; now Mistral realtime for all languages (batch one switch away) — live check at low levels to do |
| AA | Questions too hard / DELF-DALF-like, no warm-up, for/against arguments | 🟡 question bank built (6 languages); simulator + live check and client review to do |
| AB | Levels compressed around B2 (72/100), C1/C2 hard to reach, "2-step" scoring felt harsher | ⬜ to investigate once sessions are saved again |
| AC | *(Baptiste's idea)* Adaptive session length: stop early when the level is clear, run longer when it isn't | 🟡 **switched on by default 2026-10-08** (3–7 min); calibration (AC-08/09) and landing-copy sign-off still open |
| AD | "Jokers": don't penalise answers when the error looks like a speech-to-text error | 🟡 simple forgiveness rule built (pronunciation + evaluator v4, commit 4e1bb7c); admin display + level replay to do |
| AE | Score in steps of 5 instead of steps of 10 | ✅ built — axes in half points (prompt v3); replay over stored sessions to do |
| AF | Questions still too hard for an A1 speaker | 🟡 A1 bank simplified (afd3376); code-picked A1, A1 warm-up, starting rung still open; sim re-run in progress |
| AG | Configurable "callback" when a score is available, visible in admin | 🟡 built, **not activated** (default URL https://www.elao-test.com/callback), shown on `/admin/system-config`; receiving side to agree with the client |
| AH | Satisfaction form at the end of the test (beta period) | ✅ built differently from the proposal (commit 6334f69, migration 0012) — admin list column/summary to check |

**Order (2026-10-01 additions):** AE and AG done first (Baptiste's call, 2026-10-01) → AF and AH (small, directly visible to beta testers, and AH starts collecting data right away) → AD (overlaps AB-06 / Z-03, do them together).

**Order:** X → Z → AA → Y (rest) → AB. AB-06/AB-07 (scoring penalised by recognition errors) can go before AA — small, contained, and they directly explain "levels compressed around B2".

---

## Track X — Sessions saved as "not finished" ✅

**Feedback:** "There's still an issue with conversations shown as not finished when they are finished — maybe a cookie or browser issue."

**⚠ finding — cause (DB check 2026-09-28):** migration `0010_session_status` is applied. The pattern is length-based: every full-length (~3.5 min) conversation stayed `in_progress` with no evaluation, including the whole beta series of 2026-09-24 18:39–19:01 (EN, ES, IT, NL ×2, DE); the two that saved that evening were short (96 s, 128 s). The final `POST /api/sessions` carried all audio as multipart: full-session recording (~3.3 MB) + one WAV per answer (~3.8 MB) ≈ **7 MB, above Vercel's 4.5 MB request limit**. The save was rejected before reaching the route, the error only went to the browser console, and the user still saw their result on screen. Consequence: **the three "B2 72/100" results from the feedback were never stored** and can't be inspected (see AB).

**Done**
- [x] **X-01** New public route `POST /api/sessions/audio-urls` (`createSessionAudioUploadUrls` in `lib/sessions-service.ts`): mints single-use signed Storage upload URLs in a fresh `<lang>/<date>/<uuid>/` folder (`session.<ext>`, `turn-<i>.<ext>`; extensions allow-listed).
- [x] **X-02** `saveSession` (`app/page.tsx`) uploads the audio straight from the browser (`uploadToSignedUrl`, in parallel) and sends only paths to `POST /api/sessions`; the server accepts only paths matching the minted shape and the turn's own index. A failed upload loses that recording, never the session.
- [x] **X-03** Failures now leave a trace: `session_save_failed` / `session_audio_upload_failed` client log events.
- [x] **X-04** Tested locally end to end: 6.5 MB session file + turn file uploaded and linked; forged path and bad extension rejected; upload URL is single-use. Test row and files deleted.

**To do**
- [x] **X-05** (checked 2026-10-05) Deploy, run one full-length session on Vercel, confirm it ends `completed` with audio.
- [ ] **X-06** (optional) Check Vercel logs for 413s on `POST /api/sessions` to confirm the diagnosis retroactively.
- [ ] **X-07** (optional) Show the user a message if the save fails, instead of silence.

---

## Track Y — Turn-taking: freezes, cut-offs, stuck questions 🟡

**Feedback:** NL/DE: "Léa didn't seem to understand when I stopped talking, it froze several times" (NL test restarted 3×). ES test 1: "I said *no comprendo*, she didn't rephrase, I was stuck on question 2." ES test 2: "she didn't give me time to answer, the next question sometimes came as if I had answered; I answered 'what's your brother's name' but she stayed stuck on it."

**Done (uncommitted)**
- [x] **Y-01** Deaf-session bug: an empty or failed transcription returned while still holding the turn lock, so every later answer was buffered and never processed. `abandonTurn` releases it and shows "Je n'ai pas bien entendu — pouvez-vous répéter ?".
- [x] **Y-02** "Je ne comprends pas" button + detection of non-comprehension phrases in all 6 languages (`lib/comprehension.ts`) → Léa re-asks the same question more simply; a second failure switches to an easy concrete topic.

**To do**
- [ ] **Y-03** End-of-turn silence is 1.2 s for short answers (`SILENCE_MS_SHORT`, `lib/turn-vad.ts`) — too short for beginners searching for words. Lengthen it at A1/A2 rungs.
- [ ] **Y-04** "Next question came as if I had answered": check the 2026-09-24 ES session (`cc410a09…`) logs for phantom turns (Léa's own voice or noise picked up as an answer).
- [ ] **Y-05** "Stuck on the brother's name": confirm in the same logs that it was a bad or empty transcript (should be covered by Y-01 + Z-01).

---

## Track Z — Transcription quality 🟡

**Feedback:** DE/NL/FR transcripts "completely off" although the audio is clear; NL: "Ik heb bezocht Luik" → "Ik heb bezocht leugen", "De leukste stad van België" → "The Luxe Stats in Belgium". Client: Voxtral transcribes best but must be told the language, it gets lost at low levels; suggests "Voxtral transcription validated by Azure for pronunciation".

**⚠ finding:** the live path is Mistral's realtime Voxtral (`lib/realtime-stt.ts`), which opens the socket with only `?model=…` — **no language is sent** (the endpoint has no language parameter, confirmed in its docs). The batch fallback does send it (`lib/stt/providers/voxtral.ts`). The client's suggested architecture is already the current one (Voxtral transcript, Azure + Deepgram pronunciation evidence judged by Mistral).

**⚠ finding 2:** the VAD (`lib/turn-vad.ts`) only forwarded **above-threshold** frames to streaming STT — quiet parts of speech (soft consonants, word endings, short in-word pauses) and the onset before the threshold were never sent, so the recogniser got a chopped signal. Likely a cause of bad transcripts in every language, including FR.

**Current state (2026-09-30): Mistral realtime (no language hint) for all 6 languages, with the VAD fix.** Any failed/timed-out streaming turn still falls back to language-tagged Voxtral batch. Switches in `lib/realtime-stt-config.ts`:
- `REALTIME_STT_ENABLED = false` → every language on Voxtral batch (language-tagged, ~1 s more wait per answer);
- `REALTIME_STT_PROVIDER_BY_LANG[lang] = null` → that language only on batch; `"gradium"` → Gradium streaming (en/fr/de/es/pt only).

**History (all 2026-09-30)**
1. Moved en/fr/de/es to **Gradium streaming** (language set), nl-BE/it to Voxtral batch.
2. **Reverted off Gradium** after Baptiste's first real EN session on it (`e96e95b8…`, B2+ 78): ~9 meaning-changing errors. Re-running the 6 stored turn WAVs: Voxtral batch ~3, Deepgram nova-3 ~3. Examples: "long diagonals" → "long juggernauts" ×2, "different" → "front", "streak" → "strike", "I live in Paris" → "I am even embarrassed". Two of the worst were answer-initial words → possibly onset clipping in our pipeline rather than Gradium's model. Caveats: one speaker, streaming vs batch isn't like-for-like, and Voxtral batch smooths over restarts/repetitions (hides some fluency evidence). The scoring impact is in Track AB.
3. **Default set to Mistral realtime everywhere** (Baptiste's call: speed over the language hint), batch kept one switch away.

**Done**
- [x] **Z-01** `lib/realtime-stt-gradium.ts` (new): Gradium streaming client, same per-turn contract as the Mistral one (`StreamingStt` interface in `lib/realtime-stt.ts`); EU endpoint, token per turn from new `app/api/gradium-token`. Kept wired, not used by default.
- [x] **Z-01b** Per-language provider map `REALTIME_STT_PROVIDER_BY_LANG` (`gradium` | `mistral` | `null` = batch). `turn_stt_final` logs carry `sttProvider`.
- [x] **Z-01c** VAD: forwards every frame from speech start to finalize (quiet in-speech frames included) plus ~340 ms of pre-roll.
- [x] **Z-01d** Gradium tested against the live APIs with synthetic speech (DE/FR/ES exact, ~0.4 s latency; without lead-in audio the first word is dropped → pre-roll). NL/IT batch: exact except "Luik" → "Luit".
- [x] **Z-07a** Admin provider snapshot (`lib/system-config.ts`) shows STT per language, driven by the same map.

**To do**
- [x] **Z-05** (checked 2026-10-05) Live check with Mistral realtime + VAD fix, one session per language, real mic, **including a low-level speaker in FR/DE/NL** — the missing language was the beta complaint. If transcripts come out in the wrong language, set that language to `null` (batch).
- [x] **Z-10** (2026-10-05) Live transcripts cut off while the audio goes on (found by AD-01: 3 of 35 turns, all in session `709b84c6…` of 10-01, e.g. a 59 s answer stored as 56 words instead of ~105). **Cause: Mistral's realtime stream, not our browser pipeline.** `scripts/stt-replay.ts <wav-url> [--pace realtime|fast]` replays a stored turn through the same endpoint: a different 51 s turn comes back complete (107 words), but the 59 s turn fails differently on every run — "Timeout waiting for response" with no text, or a few partial deltas then `EngineDeadError` on Mistral's inference engine. Our client only falls back to batch on an outright error or an empty text, so a stream that ends "done" with half an answer passed as final. **Mitigation built (untested live):** `app/page.tsx` cross-checks any answer with ≥ 8 s of speech and < 70 wpm against the batch transcription and keeps the batch text if it has ≥ 20 % more words (`TRUNCATION_CHECK_*` in `lib/realtime-stt-config.ts`, `turn_stt_truncation_check` client event shows when it fires). **Not covered:** small tail losses (5–6 words) don't trip a wpm test; the start-of-turn clipping ("Our chest" for "At chess") is a different cause (the recorder starts before the VAD triggers, so the audio holds words the STT never got) — not looked at yet. Check after a few real long answers: how often `turn_stt_truncation_check` fires and whether `usedBatch` is true.
- [ ] **Z-09** Measure instead of guessing: an offline script that runs stored turn WAVs through Mistral realtime, Voxtral batch (and Gradium, see Z-08) and prints them side by side — reuse for every provider decision.
- [ ] **Z-08** Before re-enabling Gradium: stream the stored turn WAVs through `lib/realtime-stt-gradium.ts` with and without extra lead-in audio (onset-clipping hypothesis); repeat on one FR session and one low-level learner.
- [ ] **Z-02** Place names / domain words: Mistral realtime has no biasing; Voxtral batch — check for a prompt/context option ("Luik" → "Luit"); Gradium has `keywords` (up to 500 words) if it comes back.
- [ ] **Z-03** Final evaluator still counts likely recognition errors as speaker errors (Track V finding 6, NL tester's "errors I didn't make", "strike" in `e96e95b8…`). Enforce the "dismiss recognition errors" rule.
- [ ] **Z-07b** Update the STT row in `doc/assessment_process.md` (still says batch Voxtral only).
- [ ] **Z-04** Tell the client: their suggested Voxtral + Azure setup was already in place; the gaps were the missing language and the chopped audio. Gradium (with language) was tried and dropped on accuracy; now Voxtral realtime + VAD fix, language-tagged batch available per language if needed.

---

## Track AA — Questions too hard 🟡

**Feedback:** "I understand every word but have no idea how to answer — like DELF/DALF questions, no longer a language test." FR example: "If you had to justify this contradiction to a doctor, what would your arguments be?" Client proposals: start with 1–2 easy icebreakers even at C1/C2; keep C1/C2 questions accessible via a question pool; avoid asking to argue for or against an idea.

**Decision (Baptiste, 2026-09-28):** build a curated question bank — this reverses the Track V decision "no hand-written C2 bank".

**⚠ finding:** C1/C2 had **no bank at all**: the model wrote every question itself, and the only examples it had were debate prompts ("strongest argument against your view", "argue the opposite of what you just said"), plus abstract society-debate seeds for topic switches. A1–B2 banks existed but in English only, translated by the model on the fly, and the model was told to make up about half its questions.

**Design (Baptiste, 2026-09-30):** code picks the question at C1/C2 only; A1–B2 keep "the model picks from a slice"; every entry written in all 6 languages; bank kept in code with a read-only admin page for review.

**Done (uncommitted)**
- [x] **AA-01** Warm-up: the opening question comes from a warm-up bank (10 easy everyday questions), whatever the starting rung. It counts as a normal answer (client question 2 still open). Only the first question is a warm-up; a second one wasn't added.
- [x] **AA-02** New examiner rule: never ask to argue for/against, argue the opposite, play a role or convince/justify to an imagined person. C1/C2 ladder descriptions rewritten around personal experience and reflection. The C1/C2 debate examples and the abstract switch seeds are deleted.
- [x] **AA-03** Bank in `lib/question-bank/` (115 entries: warm-up 10, A1 15, A2 17, B1 17, B2 24, C1 16, C2 16), each in fr/en/nl-BE/es/it/de. A1–B2 ported from the old English lists and tagged by topic ("What is your name?" / "How old are you?" dropped as one-word answers). C1/C2 are new: 2 per topic, each with a simpler version and 2 follow-ups. FR + EN drafted first, the other 4 languages translated in the same pass → **needs native review**.
- [x] **AA-04** C1/C2 flow in `lib/examiner-prompt.ts`: bank question (unused, preferring a topic not covered yet or the forced-switch target) → ONE of its pre-written follow-ups → next bank question. A forced topic switch skips the follow-up. "Je ne comprends pas" at C1/C2 uses the pre-written simpler version. State (`bankState`) is round-tripped with the client like `usedQuestions`, which now holds bank ids. At A1/A2 the examiner is told to ask bank questions as written and only add simple follow-ups.
- [x] Admin page `/admin/question-bank` (per language, by level and topic, showing simpler versions and follow-ups) for the client's review.
- [x] Offline check of the prompt builder (no LLM): data complete in all languages, C1 alternation, topic switch, clarify, closing turn, A1 slice in German.

**To do**
- [x] **AA-05** (checked 2026-10-05) Run the conversation simulator (`/admin/simulator`) at C1 and C2 (FR, EN) and at A1 (NL, DE): check the examiner actually asks the picked question, the follow-up fits, and no for/against or role-play question appears.
- [x] **AA-06** (checked 2026-10-05) Live FR session starting at C1: warm-up first, then bank questions; check `bankQuestionId` in the `chat_request_received` logs.
- [ ] **AA-07** Native review of the nl-BE/es/it/de wording, then the client reviews the FR/EN content on `/admin/question-bank`.

---

## Track AB — Level results ⬜ (kept in plan)

**Feedback:** EN C2 → B2 (72), ES C1 → B2 (72), IT B1 → B2 (72), NL A2 → A1+, DE A2 → A1, DE A1 → A2; another tester EN B1 → B2 ("maybe overrated"), NL A2 → A2. Client: "without a starting level it's harder to reach C1/C2"; "not sure the new 2-step way is right — the previous model seemed better, the new one is harsher".

**⚠ finding:** the three identical B2/72 results were lost by the Track X bug, so they can't be inspected. Three identical scores for C2/C1/B1 speakers suggest a default/fallback value or an LLM anchoring on 72 — check first once new sessions are saved.

**To do**
- [ ] **AB-01** After X ships: collect new tester sessions and inspect stored evaluations (axes, raw LLM score, bonus, fallback path) — especially any repeated 72.
- [ ] **AB-02** Ask the client what "2 temps" means (live difficulty ladder + final evaluation? the new pronunciation system?) and which earlier behaviour they preferred.
- [x] **AB-03** (2026-10-08, uncommitted) Scoring replay built in the new `analysis/` folder: `npm run analysis:scoring -- --scenario <name[,name]>` (`--list`, `--lang`, `--since`, `--source`). Scoring rules are data (`analysis/lib/rules.ts`, checked against the live `computeCompositeCefrScore` on every run — 59/59 today), scenarios in `analysis/scenarios.ts` (now overrides of the live rules: `llm-base`, `no-floor`, `floor-looser`, `wpm-fluency`, `bonus-8.5`, `bonus-3-axes`, `no-bonus`). Full guide in `analysis/README.md`; admin mention on `/admin/scoring`. Reports go to `analysis/reports/` (git-ignored). **First results (59 stored live sessions):** `c2-floor` moves 5 C1+ → C2 and nothing else; `wpm-fluency` alone moves nothing (axes only matter through the +5 % bonus; fluency 9 → 10 changes no level); `axis-mean` moves 42 of 59 up, 9 by more than two steps — confirms Track V finding 4 (averaging the axes inflates weaker candidates), do not ship. Note: the DB column `cefr_level` is the evaluator's level *before* the bonus; users see the composite.
- [ ] **AB-04** Faster promotion when no starting level is given (Track V "level-promotion detection": jump ≥ 2 rungs on a clearly stronger answer, guarded by evidence).
- [ ] **AB-05** Low levels (NL/DE A2 → A1): re-check after Z-05 — bad transcripts at low levels probably pulled scores down.

**⚠ finding (Baptiste's EN session `e96e95b8…`, 2026-09-30, B2+ 78 — should likely be C1):** axes fluency 9 / vocab-grammar 8 / communication 8, pronunciation 83.6 → only 1 axis ≥ 9, so no +5 % bonus (78 × 1.05 = 82 = C1). Causes, all on the system side:
- [ ] **AB-06** **Pronunciation is penalised for recognition errors**: every correctly heard word scored 96, the misheard ones 16–42 (the assessment is run against the wrong reference text). Without them the average is ~90+ → bonus → C1. Ignore or down-weight words the recogniser was unsure of, or assess against a better transcript.
- [ ] **AB-07** **Judge ignores its own rubric**: 161 WPM (table says ≥ 145 → fluency 10) got 9; its summary ("near-native fluency… no significant weaknesses") matches the prompt's "→ C1, not B2" anchor yet it chose B2+. Enforce the WPM → fluency mapping in code rather than trusting the LLM; consider deriving the level from the axes instead of the LLM's `score_percent` (see Track V finding 5).
- [ ] **AB-08** **Last answer had no pronunciation data**: the longest answer (100 words) came back from the fallback EO path with `words: []`, score 0 — correctly excluded from the average (count 5 of 6), but the best evidence was lost. Check why EO fell back on that turn.
- [ ] **AB-09** **Questions gave little room at the top**: "Which game?", "Longest streak?" produced a 5-word answer; no opinion/hypothetical question in 3 minutes → little C1 evidence. Feed into Track AA (warm-up then at least one open, personal-opinion question).

---

## Track AC — Adaptive session length 🟡 (shadow mode)

**Idea (Baptiste, 2026-09-30):** instead of a fixed length, keep asking while the level is uncertain and stop once it has settled — **min 3 min, max 7 min**. Addresses AB-09 (not enough room to show C1/C2), Track V (natives can't reach C2) and needlessly long sessions for clear-cut beginners.

**Decisions:** certainty signal = the **difficulty ladder** ET already drives (no new LLM call); bounds 3–7 min; **shadow mode first** — sessions keep their fixed length, the rule only records where it would have stopped.

**Risks:** (1) ET is generous (took Baptiste B1 → C2 in 3 answers), so the rule inherits its bias → evidence gates + calibration; (2) variable length breaks the countdown and the client-approved "Votre niveau en 3 minutes" copy (Track U) → client sign-off before going live; (3) shorter sessions give the final evaluator less evidence → the 3-min floor.

**Stop rule** (`lib/session-length.ts`, pure, thresholds as constants at the top): settled when the last ET results show **bracketed** (last 4 within two adjacent rungs, ≥ 2 up/down reversals → estimate = highest rung answered "well"), **plateau** (3 × "adequate" at one rung), **ceiling** (2 × "well" at C2) or **floor** (2 × not-"well" at A1). Gates: ≥ 5 judged answers; estimate ≥ B2 needs one answer ≥ 25 words at or above it.

**Done (2026-09-30, uncommitted)**
- [x] **AC-01** `lib/session-length.ts`: `evaluateStop`, `shouldCloseSession`, `LadderRecord`; checked on hand-made ladders (bracketed, plateau, ceiling, floor, too few answers, C2 without a long answer, still climbing) and the time bounds.
- [x] **AC-02** `lib/session-config.ts`: `SESSION_LENGTH_MODE` (`"fixed"` | `"shadow"` | `"adaptive"`, now `"shadow"`), `SESSION_MIN_SECONDS` = 180, `SESSION_MAX_SECONDS` = 420. `?minutes=N` URL override (1–15) for fixed/shadow length, so testers can run 7-min calibration sessions.
- [x] **AC-03** `app/page.tsx`: every ET result appended to the ladder (rung, verdict, next rung, words, time) — **the rung per turn is now stored**, a gap noted in Track V. The close effect uses `shouldCloseSession` (same graceful `__END__` path); `session_length_decision` client log event when an adaptive session would have closed. Adaptive mode counts down to the max.
- [x] **AC-04** Storage: migration `0011_session_ladder.sql` (`sessions.ladder_json`), sent by the live save and the final save. Written by a separate best-effort update (`saveLadder`) and read separately in `getSessionDetail`, so an environment **without 0011 still saves and shows sessions** (ladder just missing, warning logged).
- [x] **AC-05** Admin detail: "Difficulty ladder & session length" section (`components/LadderPanel.tsx`) — per-answer rung/verdict and "would stop at m:ss · level (reason)" vs actual length and final level.
- [x] **AC-06** Prompts: in adaptive mode the intro says "a few minutes" (6 languages); fixed/shadow text unchanged.

**To do**
- [x] **AC-07** `0011_session_ladder.sql` applied to `ootlydfnbghchqolxbru` (single project for dev and prod) on 2026-09-30, by hand in the SQL editor.
- [ ] **AC-08** Collect ~15–20 shadow sessions, including several `?minutes=7` runs at different levels.
  - **#1 (Baptiste, EN, 2026-09-30, `0d381874…`, 7:16, 8 answers, Mistral realtime):** final C1 82 → **C1+ 86** with bonus (axes 9/9/8, pron 90 — vs 84 on Gradium this morning, supports AB-06). Rule: **would stop at 4:42, "ceiling", estimate C2**. Final evaluator re-run on the first 5 answers only (×2) = **identical C1+ 86** → nothing lost by stopping early. Notes: ET said "well" to all 8 answers (C2 by 1:53), so the ladder estimate (C2) ≠ final level (C1+) — use it for the stop decision only, never as a score; strong speakers will mostly stop on "ceiling"; the binding constraint was the 5-answer gate (ceiling reached at 3:49 on answer 4), not the 3-min floor — long answers make 5 answers ≈ 5 min.
- [x] **AC-10** (2026-10-08) **Adaptive length is now the default:** `SESSION_LENGTH_MODE = "adaptive"` in `lib/session-config.ts` (3–7 min; the session ends once the ladder has settled past 3:00, always at 7:00). The progress UI already showed answers given rather than a countdown; the examiner intro says "a few minutes" (6 languages); the French landing now reads "Votre niveau en quelques minutes" / "Une conversation de quelques minutes" (`SESSION_LENGTH_LABEL_FR`), replacing the client-approved "3 minutes" wording — wording confirmed by Baptiste 2026-10-08. `lib/session-cost.ts` `AVG_SESSION` deliberately left at its old values for now. The stop-rule thresholds were calibrated on one session only (a stored-ladder replay was considered and dropped). Revert = `"shadow"`.
- Known quirk in shadow `?minutes=7` runs: Léa still announces "about 3 minutes".

---

## Track AD — "Jokers" for likely speech-to-text errors ⬜

**Feedback (2026-10-01):** study "jokers" so that some answers are not penalised when the error seems to come from the speech-to-text, not the speaker.

**Where recognition errors hurt today (⚠ finding, from AB-06 / Z-03 / Track V finding 6):**
1. **Pronunciation**: misheard words are assessed against the wrong reference text and score 16–42 while correctly heard words score ~96 (`e96e95b8…`). A handful of them pulls the session average under 90 and removes the +5 % bonus.
2. **Vocabulary/grammar**: the final evaluator quotes recognition errors as the speaker's errors ("s'allader", "strike") and caps the axis at 8, although its prompt says to dismiss them.
3. **Pacing (ET)**: a garbled answer can be judged "struggled" and lower the rung.

**Decision (Baptiste, 2026-10-05): a simpler rule than the "detect, then forgive" word-by-word design first proposed here.** A generally strong candidate's one or two errors are presumed to be the recogniser's and not counted. The allowance depends on answer length and on how good the rest of the answer is; no cross-recogniser comparison is needed. All variables are constants in code (`RECOGNITION_FORGIVENESS` in `lib/recognition-forgiveness.ts`), not in admin.
- **Pronunciation (per answer):** words the judge marked off/bad (accuracy < 50) are forgiven worst-first — 0 words if the answer has < 8 words, 1 for 8–39 words, 2 for ≥ 40 words — and only when the rest of the answer still averages ≥ 85. The answer is then scored on the remaining words (the judge's own turn score is not used, because it caps the turn at 65 on a single word-changing error). Forgiven words are flagged `forgiven: true` on the stored word.
- **Evaluator (per session):** for a strong speaker (pronunciation ≥ 85, ≥ 110 WPM, ≥ 100 words) the user message tells the model to presume up to `floor(words / 60)` apparent errors, max 3, are recognition errors: not quoted, not lowering vocabulary/grammar. `CEFR_PROMPT_VERSION` → **v4**.
- **Cap** is built in (max 2 words per answer, none when the rest isn't good). A weak speaker is never rescued: in the replay the Italian 37.5 and German 70 sessions don't move.
- **Pacing judge (ET):** untouched for now.

**To do**
- [x] **AD-01** (2026-10-05) Measured with `scripts/asr-disagreement.ts` (`npx tsx scripts/asr-disagreement.ts --limit 20 [--lang fr] [--since 2026-09-30]`; writes `sim-runs/asr-disagreement-*.md`; re-runs Deepgram on stored turn WAVs and aligns word by word with the stored transcript; ignores fillers and digit/spelled-number formatting). Result on the 6 sessions saved since the current STT stack (**all English, all Baptiste's own** — no FR/DE/NL/ES/IT or low-level data yet): 8.9 % of live words differ, only 51 of 190 differences are true word-for-word substitutions.
  - **Real recognition errors the signal catches:** "long juggernauts" / "diagonals", "this trick" / "the strike" (actually "streak"), "I am even embarrassed" / "I live in Paris", "front" / "different", "Robbie's" / "rob his", "person" / "pass in", "friends" / "France".
  - **Deepgram is wrong too:** "wars" → "worst" ×3, "tourist" → "truest", "depends" → "deepens". Disagreement says *someone* misheard, not *who* — fine for a forgiveness rule, not for a correction rule.
  - **Ambiguous for a non-native:** singular/plural and article differences ("language" / "languages", "downside" / "downsides", "a" / ∅) could be the speaker's own errors. Forgive them only with a cap, or only for fluent speakers.
  - **⚠ New finding — truncated live transcripts:** in 3 of 35 turns the live transcript stops early while the stored audio goes on (Deepgram hears 20–40 more words, e.g. "…worst part of humanity and." where the answer continues for another 25 words). Also a clipped start in some turns ("Our chest" for "At chess", "I'm friends" for "In France"). This is separate from jokers: the evaluator and the pronunciation judge never see that part of the answer. Likely a finalisation race in the realtime STT (`lib/realtime-stt.ts`) — to investigate as **Z-10**.
  - **Old NL data was useless for this:** the 09-28/29 NL sessions have live transcripts in French or English ("Traduction.", "Il y a il cap un an…") for Dutch speech — the pre-fix bug, not a joker case.
  - Need FR/DE/NL/ES/IT and low-level sessions from the beta before calibrating the cap (AD-02…06).
- [x] **AD-02** (2026-10-05) Pronunciation: forgiveness applied per answer in `lib/pronunciation/providers/azure-ensemble.ts` (fixes AB-06). Replay on 23 stored sessions (`npx tsx scripts/forgiveness-replay.ts`): 15 change, mostly by 1–3 points; Baptiste's `e96e95b8…` goes 83.6 → 90.4 (the +5 % bonus case); weak sessions unchanged. Existing sessions keep their stored scores; only new runs (and eval-lab re-runs) use it.
- [x] **AD-03** (2026-10-05) Evaluator: allowance note in the user message for strong speakers (`buildEvaluatorForgivenessNote`), prompt version v4. Not yet tested against the real evaluator — re-run `e96e95b8…` and `0d381874…` in the eval lab and check the axes/notable errors.
- [~] **AD-04** ET: not part of the simple rule; revisit only if a garbled answer visibly lowers the rung.
- [ ] **AD-05** Admin: show forgiven words per turn and per session (the `forgiven` flag is stored on each word; no UI yet).
- [ ] **AD-06** Replay over stored sessions (same script as AB-03): which levels change, check nothing jumps more than one "+" without reason. Pronunciation part done (`scripts/forgiveness-replay.ts`, see AD-02); the level-change part needs the full replay script.

---

## Track AE — Score in steps of 5 instead of steps of 10 ✅

**Feedback (2026-10-01):** "faire évoluer le scoring vers des paliers de 5 plutôt que des scores par dizaines."

**What the code did (⚠ finding):** the level bands were **already** 5 points wide (`scoreToLevel` in `lib/cefr-score.ts`: A1 40, A1+ 45, … C2 90). What moved in steps of 10 were the **three LLM axes** (fluency, vocabulary/grammar, communication): whole numbers 0–10, i.e. 70 / 80 / 90 on a 100 scale. That is coarse exactly where it matters, because one point on an axis is the difference between 8 and 9, which decides the "2 axes ≥ 9" bonus. Pronunciation was already 0–100.

**Decision (Baptiste, 2026-10-01):** axes in **half points** (0, 0.5 … 10 = steps of 5 on 100).

**Done (2026-10-01, uncommitted)**
- [x] **AE-02** `lib/cefr-prompt.ts`: "HALF POINTS" rule in the dimension guide (a .5 when the speaker sits between two descriptors, no other decimals), schema comments, WPM → fluency bands 8–8.5 / 9–9.5 at the top. `CEFR_PROMPT_VERSION` bumped to **v3** (eval-lab rows stay distinguishable from v2).
- [x] New `parseCefrEvaluation()` (same file), used by all three callers (live `/api/evaluate`, eval lab `lib/cefr-eval.ts`, simulator): clamps each axis to 0–10 and rounds it to the nearest 0.5 whatever the model returns (8.7 → 8.5, "8.2" → 8, 11 → 10); `score_percent` rounded to an integer.
- [x] **AE-03** Bonus rule unchanged: an axis must be **≥ 9** to count; **8.5 does not count** (comment in `lib/cefr-score.ts`, copy on `/admin/scoring`). To revisit with the Track V C2-floor rule.
- [x] **AE-04** Display: `Bar` (`components/ScoreDisplay.tsx`) showed `Math.round(value)`, which would have turned 8.5 into 9. 0–10 bars now show one decimal ("8.5", "9", pronunciation /10 e.g. "9.1"). The admin score breakdown already shows axes ×10, so 8.5 appears as 85 there. `/admin/scoring` copy updated.
- Existing sessions keep their whole-number axes; nothing is migrated.

**To do**
- [ ] **AE-05** Replay over stored sessions (AB-03 script): level changes old vs new, and check that the model actually uses half points (not only whole numbers).
- [x] **AE-06** (checked 2026-10-05) One live session to check the results screen and admin panel show the half points.

---

## Track AF — Questions still too hard for A1 ⬜

**Feedback (2026-10-01):** "Les questions posées à un user A1 sont encore trop dures, il faudrait vraiment simplifier."

**Likely causes (⚠ finding, from the code; to confirm on the tester's session):**
1. **French starts at A2** (`startingRung` default A2, admin setting), so an A1 speaker gets A2 questions until ET drops them, and a drop takes a "struggled" verdict.
2. **The warm-up opener is the same for everyone** (Track AA-01): "Parlez-moi un peu de l'endroit où vous habitez" is an open "tell me about" question — too open for a true beginner. It is also preceded by a 2–3-sentence intro at natural complexity.
3. **The A1 bank itself is still open-ended**: "Tell me about your brothers or sisters", "Tell me about a pet…". The rule "avoid yes/no questions" (`buildCommonRules`) pushes the model away from what a beginner can actually answer.
4. **Follow-ups are model-written**: the A1/A2 prompt allows one own follow-up, which can be more complex than the bank question.
5. TTS is slowed until B1 (`SLOW_RATE`), so speech speed is already handled.

**Proposal**
- **A1 = closed and choice questions are allowed and preferred**: "Vous avez des frères ou des sœurs ?", "Vous habitez dans une maison ou un appartement ?", "Vous aimez le sport ?". At most ~8 words, present tense, the 500 most common words, one idea. The "avoid yes/no" rule is lifted at A1 only; the follow-up is a fixed, very short "Pourquoi ?" / "Comment s'appelle-t-il ?" type.
- **Rewrite the A1 bank** (all 6 languages) in that style, each entry with a pre-written short follow-up, and **let the code pick at A1** like at C1/C2 (same `bankState` mechanism), so the model can't make A1 questions harder.
- **Adaptive warm-up**: when the starting rung is A1/A2, use an A1-style warm-up ("Vous habitez où ?") and a shorter intro (one sentence: "Bonjour, je m'appelle Léa. On parle trois minutes en français ?").
- **Starting rung**: consider starting at A1 (or offering "Je débute" on the landing page) instead of A2 — trade-off: stronger speakers spend one more turn climbing (to weigh against AC's adaptive length and AB-04 faster promotion).
- **ET at A1**: one-word or two-word correct answers are "well" (already in the foundation addendum) — check it holds in the tester's session.

**To do**
- [ ] **AF-01** Get the A1 tester's session (language, date) and read the questions actually asked and the rung per turn (`ladder_json`, Track AC).
- [~] **AF-02** (afd3376, 2026-10-05) A1 bank rewritten: one short question per entry, no compound "X, and why?". Closed/choice style and fixed follow-ups not confirmed.
- [x] **AF-03** (2026-10-07, uncommitted: A1 added to the code-picked rungs via `isCodePickedRung`, one fixed follow-up per A1 entry in 6 languages — native review needed; yes/no rule lifted at A1; family-01 made closed) Code-picked questions at A1 (reuse the C1/C2 `bankState` flow in `lib/examiner-prompt.ts`); lift the yes/no rule at A1.
- [x] **AF-04** (already in the code before this round: `easyOpening` + A1-bank opener for foundation starts) A1-style warm-up and one-sentence intro when the starting rung is A1/A2.
- [ ] **AF-05** Decide the starting rung / "Je débute" option with the client.
- [x] **AF-06a** Batch tool: `npm run sim:batch -- --level A1 --lang fr --runs 10` (`scripts/sim-batch.ts`) plays N simulated sessions through the real examiner/ET/evaluator, computes per-turn metrics (understanding, question length, rung path, ET verdicts, final level vs simulated level) and writes `sim-runs/<date>-<level>/report.md` + an LLM analyst reading. Mistral is paced to ~26 req/min, so 10 sessions ≈ 15 min. Also works for A2/C1/C2 (`--level C1 --start C1`). The simulator now mirrors live's "I didn't understand" re-ask (it didn't before).
- **Baseline, 2026-10-01 (FR, learner A1, examiner starting at A2, 10 sessions, *before* the clarify fix above):** final level A1 ×6 / A1+ ×4 (calibration fine). But: the opening line (intro + warm-up, 20–29 words) was **never** fully understood by the simulated A1 learner; only ~3-word questions ("Où habitez-vous ?") were understood in full; 80 % of sessions had at least one question not understood at all; ET judged short fragments ("Liège. Grande ville.") "well" (avg 9.8 words for "well" vs 9.4 for "struggled") so the ladder yo-yoed A1↔A2 and reached B1 in 4/10 sessions.
- [~] **AF-06b** Re-run the baseline with the clarify fix, then after each AF change (AF-02…AF-04) with the same command, and compare `summary.json`.
  - **2026-10-07 re-run after `afd3376`** (10 sessions, `sim-runs/2026-10-07T08-58-23-A1/`) vs 10-05 run (5 sessions, before afd3376): fully understood 40 % (was 43), not understood 20 % (17), first question not fully understood 50 % (60), sessions with ≥ 1 question not understood 80 % (80); question length 8.3 words (8.3), > 12 words 4 % (9); ET verdicts well 56 / struggled 37 (46 / 40); sessions reaching 2 rungs above level 20 % (0); final level exact 70 % (60), A1 ×7 / A1+ ×3. **Conclusion: shorter, single-part questions did not improve comprehension** (~54 % of A1-rung questions still not fully understood); the ladder drifts up more (5/10 sessions went above A2, B1 questions 100 % not understood) because ET says "well" to fragments. Remaining levers: AF-03 (closed/choice questions, code-picked), AF-04 (one-sentence intro), ET strictness at A1.
  - **2026-10-07 re-run after AF-03** (code-picked A1 questions + fixed follow-ups, 10 sessions, `sim-runs/2026-10-07T16-28-57-A1/`): fully understood **49 %** (40), not understood **9 %** (20), first question not fully understood **30 %** (50), sessions with ≥ 1 question not understood **60 %** (80); question length 8.8 words (8.3); ET struggled 29 / well 60; **ladder no longer climbs past A2** (0 sessions two rungs above level, no B1/B2 questions); final level exact 50 % (70): A1 ×5 / A1+ ×4 / A2 ×1 — the A2 and A1+ are an evaluator over-estimate to look at. Clear gain on comprehension and ladder drift; still ~47 % of A1 questions only partly understood (the simulated learner is strict). Not committed yet.

---

## Track AG — Score callback, visible in admin 🟡 (built, not activated)

**Feedback (2026-10-01):** add a possible "callback" at the end, configurable, when a score is available. Configured in the code, but visible in the admin.

**Decision (Baptiste, 2026-10-01):** default URL `https://www.elao-test.com/callback`, **not activated**, but shown in the admin.

**Done (2026-10-01, uncommitted)**
- [x] **AG-02** `lib/score-callback.ts`: `SCORE_CALLBACK = { enabled: false, url, events: ["session.completed"], timeoutMs: 5000, maxAttempts: 3, signatureHeader: "X-Elao-Signature" }`. The URL defaults to `https://www.elao-test.com/callback`, overridable per environment with `SCORE_CALLBACK_URL`. The body is signed with HMAC-SHA256 (`sha256=<hex>`) when `SCORE_CALLBACK_SECRET` is set (both documented in `.env.example`). Delivery: POST, retries with backoff (1 s, 2 s) on network errors and 5xx, no retry on 4xx. Never throws.
- [x] **Payload**: `event`, `session_id`, `user_id`, `language`, `duration_seconds`, `completed_at`, `level` + `score` (our headline composite score, bonus included, i.e. what the user sees), `confidence`, `axes` (pronunciation, fluency, vocabulary_grammar, communication, all 0–100), `report_url` (admin session page).
- [x] **AG-03** Fired server-side from `POST /api/sessions` after the final save, via `next/server`'s `after()` (runs after the response, never delays or fails the save). It reloads the saved row (`getSessionForScoreCallback` in `lib/sessions-service.ts`). Skipped when disabled or when the session has no evaluation.
- [x] **AG-04 (part)** `/admin/system-config`: new "Score callback" section with status (**Not activated**), URL (default / from env), trigger, payload, signature, delivery. Read-only.
- [x] **AG-05 (part)** Tested locally against a test receiver: signature verifies, a 500 is retried and the second attempt succeeds, and with the flag off the send is skipped (`score_callback_skipped` log).

**Not built (on purpose)**
- No delivery table yet: attempts are only logged as `score_callback_sent` / `score_callback_failed` / `score_callback_skipped` server events. A `score_callbacks` table (migration) and a per-session status + "resend" button on the session detail make sense once it is activated. The DB is shared between dev and prod, so no migration until then.
- No callback after an eval-lab re-run, and no external reference (`?ref=`) on the test link yet.

**To do**
- [ ] **AG-01** Agree with the client: real receiving URL, payload fields, authentication (HMAC signature vs bearer token), whether they need their own user reference on the test link, which events.
- [ ] **AG-06** Activate: `enabled: true` + `SCORE_CALLBACK_URL` / `SCORE_CALLBACK_SECRET` in Vercel, then one real session to check delivery.
- [ ] **AG-07** (when activated) Delivery table + status/resend on the session detail.

---

## Track AH — Satisfaction form at the end of the test (beta) ✅

**Built (commit 6334f69 "Add survey", 2026-10-05) — differs from the proposal below.** Modal (`components/SatisfactionModal.tsx`, shown from `SessionResultsScreen`) with **three 1–10 ratings** (experience, question relevance, grade relevance) + optional comment, behind `NEXT_PUBLIC_SATISFACTION_MODAL=1`. Public route `POST /api/feedback` (`lib/feedback-service.ts`); table `session_feedback` (migration `0012_session_feedback.sql`, one row per session, resubmitting overwrites). Admin: answers on the session detail page, settings and system-config entries. **To check:** admin list column / filter / summary (old AH-04); migration applied; flag set in Vercel.

*Original proposal (superseded):*

**Feedback (2026-10-01):** add a satisfaction form at the end of the test, for the beta period.

**Design (proposal)**
- **Where**: on the results screen (`phase === "done"` in `app/page.tsx`), below the level, as a short card — optional, skippable, one submit. Behind a `BETA_FEEDBACK_ENABLED` flag in `lib/session-config.ts` so it disappears after the beta with a one-line change.
- **Questions** (short, in the session language — or FR/EN UI only, see AH-01):
  1. Overall, how was the test? (1–5 stars)
  2. Does the level you got seem right to you? (too low / about right / too high) — **directly useful for AB calibration**
  3. Were the questions… (too easy / about right / too hard) — useful for AA/AF
  4. Did Léa understand you well? (1–5) — useful for Z/Y (transcription, turn-taking)
  5. Free comment (optional)
- **Storage**: new `session_feedback` table (session id, rating, level_feeling, difficulty_feeling, understood_rating, comment, created_at), migration 0012/0013, written by a public route in the same style as `/api/sessions/live` (only for the caller's own session).
- **Admin**: answers shown on the session detail page, a column/filter in the list (e.g. "level felt too low"), and a small summary (average rating, % "level about right").

**To do**
- [~] **AH-01** (superseded by the built 3-rating version) Agree on the questions with the client (and whether the form is FR-only or in all 6 languages).
- [x] **AH-02** Migration 0012 + public route (`POST /api/feedback`).
- [x] **AH-03** Modal on the results screen behind `NEXT_PUBLIC_SATISFACTION_MODAL`.
- [~] **AH-04** Admin: answers on the session detail done; list column + summary not verified.

---

## Questions for the client
1. What does "la nouvelle manière de fonctionner (en 2 temps)" refer to? (AB-02)
2. Should warm-up answers count in the evaluation? (AA-01)
3. Review of the question bank on `/admin/question-bank` (all levels, 6 languages). (AA-07)
4. After the X fix is deployed: can the testers redo one full session each so we have stored results to analyse? (AB-01)
5. ~~"Paliers de 5" meaning~~ — decided 2026-10-01: axes in half points (AE).
6. Which A1 tester session showed questions that were too hard (language, date)? Should beginners be able to say "Je débute" before the test? (AF-01, AF-05)
7. Score callback: it is built but not activated, pointing at https://www.elao-test.com/callback. What is the real receiving URL? Are the payload fields OK? HMAC signature or bearer token? Do you need your own user reference on the test link? (AG-01)
8. ~~Satisfaction form~~ — built (3 ratings + comment, 2026-10-05); confirm the wording with the client. (AH-01)

## Files touched (this round)

`lib/score-callback.ts` (new) · `app/api/sessions/route.ts` · `app/admin/(dashboard)/system-config/page.tsx` · `lib/cefr-prompt.ts` · `lib/cefr-eval.ts` · `app/api/evaluate/route.ts` · `components/ScoreDisplay.tsx` · `lib/cefr-score.ts` · `app/admin/(dashboard)/scoring/page.tsx` · `lib/question-bank/*` (new) · `app/admin/(dashboard)/question-bank/page.tsx` (new) · `components/AdminSidebar.tsx` · `lib/topic-domain.ts` · `lib/conversation-sim.ts` · `lib/session-length.ts` (new) · `components/LadderPanel.tsx` (new) · `supabase/migrations/0011_session_ladder.sql` (new) · `lib/session-config.ts` · `app/admin/(dashboard)/[id]/page.tsx` · `app/api/sessions/live/route.ts` · `lib/types.ts` · `app/api/sessions/audio-urls/route.ts` (new) · `app/api/gradium-token/route.ts` (new) · `lib/realtime-stt-gradium.ts` (new) · `lib/realtime-stt-config.ts` · `lib/realtime-stt.ts` · `lib/turn-vad.ts` · `lib/comprehension.ts` (new) · `lib/tts/providers/gradium.ts` (new) · `lib/sessions-service.ts` · `app/page.tsx` · `middleware.ts` · `lib/supabase-browser.ts` · `app/api/chat/route.ts` · `lib/conversation-prompts.ts` · `lib/examiner-prompt.ts` · `lib/tts/registry.ts` · `lib/turn-labels.ts` · `.env.example`
