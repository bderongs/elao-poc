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
| T | All sessions visible in admin | ✅ done — sessions now saved incrementally, unfinished ones shown. **Prod migration still to run** |
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
- [ ] **P-05** Spoken smoke test: one session per language, confirm the intro says "Léa".

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

## Track T — Every session available in admin ✅ (prod migration pending)

**Ask:** "Make all sessions available in admin."

**Cause (⚠ finding):** the admin list had no filter — the missing sessions were **never saved**. A session was written exactly once, at the very end, in one request carrying the transcript, scores and all audio. A closed tab, crash, network drop or failed final save left no trace.

**Done** (design agreed with Baptiste: text + pronunciation only for unfinished sessions; row created at the first answer)
- [x] **Migration `supabase/migrations/0010_session_status.sql`**: `sessions.status` (`in_progress` | `completed`, default `completed` so all existing / upload / Speechace rows stay completed) and `last_activity_at`. **Applied to the dev project (ELAO POC). Not applied to production — must be run there.**
- [x] **Incremental save**: new public endpoint `POST/PATCH /api/sessions/live` (`middleware.ts` carve-out). The client (`syncLiveProgress` in `app/page.tsx`) creates the row at the first answer and rewrites the transcript + pronunciation JSON ~1.5 s after each change. The end-of-session save (`POST /api/sessions`) now **finalises that same row** (audio, evaluation, scores, `status = completed`) and falls back to a plain insert if the live row is missing — a session is never lost. The live endpoints only ever touch `in_progress` conversation rows the caller may own.
- [x] **Admin**: Status column (in progress / not finished / completed) and an All / Completed / Not finished filter on the list; the detail page shows a banner and the transcript (from the `transcript` column) for unfinished sessions and hides the eval-lab controls (no recording / evaluation). "Not finished" = `in_progress` with no activity for 10 min, computed at read time (`lib/session-status.ts`, no cron).
- [x] Tested end-to-end on the dev DB via the API (start → progress → finalise: same row updated, no duplicate, turns saved once); test row deleted.

**Limits / open**
- Unfinished sessions have **no audio and no evaluation**. Uploading each turn's audio as it happens was considered and deferred (extra upload per answer).
- Someone who opens the page and leaves before the first answer creates no row (by design).
- [ ] Run migration 0010 on **production**.
- [ ] Live browser test: start a session, answer once or twice, close the tab, check `/admin` (should show "in progress", then "not finished" after 10 min).
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
2. **Run migration `0010_session_status.sql` on production.**
3. Live checks: unfinished-session flow (Track T), spoken "Léa" in each language (P-05), native review of pivot/bridge lists (Track S).
4. **Track V** when ready: more native sessions + a non-native control → offline replay script → C2 floor rule, evaluator tightening, promotion-detection change.
5. **Track R** stays parked until a concrete cough/noise case shows up.
6. Client questions still open: end-of-session feedback meaning (Q), missing-session sample to confirm the cause (T), native review (S), words-per-answer as gate vs axis and whether they know the +5 % bonus exists (V), go-live date of the 5-minute version (U).

## Files touched

`lib/session-config.ts` (new) · `lib/session-status.ts` (new) · `app/api/sessions/live/route.ts` (new) · `supabase/migrations/0010_session_status.sql` (new) · `lib/conversation-prompts.ts` · `lib/topic-domain.ts` · `app/api/chat/route.ts` · `app/page.tsx` · `lib/sessions-service.ts` · `lib/types.ts` · `middleware.ts` · `app/admin/(dashboard)/page.tsx` · `app/admin/(dashboard)/[id]/page.tsx` · `components/ScoreDisplay.tsx` · `doc/new_design/README.md`
