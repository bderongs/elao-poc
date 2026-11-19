# Roadmap Nov 2026 — dev plan (2026-11-12)

Source: the roadmap doc "ELAO – Évaluation de l'oral : roadmap" (Michel's mail of 2026-11-11 + call of 2026-11-12). Six workstreams; this file maps each to the code and orders the work.

Related: [`api-plan.md`](api-plan.md) (integrator API, step 1 done, blocked on API-02).

**This is the tracker for the current round.** How it is kept: tick a task when it is done (task ID in the commit message), add one dated line to §Log per work session (done · blocked · next task), tick §Waiting on Michel items with the answer.

## Order

| Phase | What | Depends on | Size |
|---|---|---|---|
| 0 | Quick wins: Mistral key, question bank edits, Dutch intro sentence | nothing | S |
| 1 | Interface language (i18n of the candidate UI + feedback) | nothing | L |
| 2 | Integrator API, extended with interface language + test profile | API-02 answers, phase 1 | L |
| 3 | Per-client questions (Safran) | Michel's answer on the mechanism, phase 2 for the API param | M |
| 4 | Audio pipeline: Deepgram out, Voxtral in | nothing — can run in parallel with 1–3 | M |
| 5 | End-of-test report (Speechace structure) | phase 1 (translation), phase 2 (report link) | L |

Phase 4 is independent and touches only the server pipeline: do it whenever phase 1 is blocked or waiting for review.

---

## Phase 0 — quick wins

- [ ] **Q-01** Mistral API key: swap `MISTRAL_API_KEY` in `.env.local` and Vercel when Michel sends it. No code. (Waiting on Michel.)
- [x] **Q-02** Remove the 18 questions from `lib/question-bank/{b2,c1,c2}.ts` (ids listed in the roadmap). Check that `usedQuestions` / the admin question-bank page don't reference them by id elsewhere (`grep` the ids).
- [x] **Q-03** Add the 4 C2 questions to `lib/question-bank/c2.ts`, each with `simpler` and 2 `followUps`. `L10n` is `Record<ConvLang, string>`, so every one needs all 6 languages: the roadmap gives French only → translate en / nl-BE / es / it / de, have the Dutch reviewed if possible. Done: B2 24→19, C1 16→11, C2 15→11; new ids `c2-home-03`, `c2-hobbies-03`, `c2-other-03`, `c2-work-02`. Translations not yet reviewed by a native speaker.
- [x] **Q-04** Fixed Dutch intro: in `lib/conversation-prompts.ts` (nl-BE opening, ~line 383) replace "Vermeld dat het gesprek … duurt" with the literal sentence « Deze conversatie duurt enkele minuten en helpt ons om uw Nederlands te evalueren. ». Same for nl-NL when it exists (L-06). Done in both the standard and the beginner opening (exception to its 8-word limit). Checked 2026-11-15: said word for word in 4/4 nl-BE and 4/4 nl-NL openings.
- [x] **Q-05** Put C2 back in evaluation. Today scores stop at C1+ (`SCORING_RULES.ceiling`, cap 89, `topOfScale` flag — `lib/cefr-score.ts`, decision of 2026-10-18). Undo: `ceiling: null` (or cap 90+), C2 floor editable in `LevelFloorsForm`, welcome screen back to "A0 to C2", results screen drops the "may be higher" note.
  ⚠ The ceiling exists because a C1 speaker was rated C2 (2026-10-14…18). `analysis/c1c2.ts` works on Speechace monologues, so it does not depend on our bank. The check that matters is the replay: `npx tsx analysis/scoring-replay.ts --scenario show-c2` (2026-11-12, 80 live sessions): 5 move C1+ → C2 (b20ec7a9, 2f824a75, a87c7133, be998587, 51bcd3a1), none down. Decided 2026-11-13 (Baptiste): report C2 again. Done: live rules = C2 by evidence (`c2Gate`, ceiling off), welcome screen "A0 à C2", admin texts and READMEs updated; `--scenario c1plus-ceiling` replays the old rule. Levels are computed on read, so those 5 past sessions now show C2.

## Phase 1 — interface language

Today the candidate UI is French only, hard-coded in `app/page.tsx` (2 800 lines), and the feedback is translated to French only (`lib/analysis-translation.ts`).

- [x] **L-01** Interface languages. Decided 2026-11-15 (Baptiste): fr, en, nl, es, it, de — one Dutch interface for nl-BE and nl-NL. Type `UiLang` in `lib/languages.ts`.
- [x] **L-02** `lib/ui-strings.ts`: one dictionary `Record<UiLang, …>`, typed so a missing string is a compile error (same trick as `L10n`). Move every candidate-facing string of `app/page.tsx`, `CandidateTopBar`, `EvaluatingScreen`, `SessionResultsScreen`, `SatisfactionModal`, `ClaimResultsForm`, `/results-saved` into it. Admin stays English.
  Progress 2026-11-15: done for the test flow — `app/page.tsx`, `EvaluatingScreen`, `SessionResultsScreen` (+ the result card's axis names, which were English on the French screen), `SatisfactionModal`, `ClaimResultsForm`, `AuthForm`, `AuthNavLink`. Context: `lib/ui-lang.tsx` (`?ui=` → localStorage → fr). Then the account pages: `/login` (+ forgot, reset), `/results-saved`, `/dashboard` (+ detail). The language is remembered in a cookie (`elao_ui_lang`) so server-rendered pages read it (`lib/ui-lang-server.ts`). Translations by Claude, not yet reviewed by native speakers. Known gap: the first paint of `/` is French, then switches (the page is a client component).
- [x] **L-03** Where the language comes from: `?ui=` on the link (read-once, like `?level=`), then the API test row (phase 2), default `fr`. Store `ui_language` on `sessions` (migration, additive).
  Progress 2026-11-15: `?ui=` and the cookie are done (L-02). Added 2026-11-15 (Baptiste): the browser language as default (`navigator.languages` / `Accept-Language`) and an interface-language menu in the candidate top bars and the dashboard (hidden during the test and the evaluation wait). Order: `?ui=` → the candidate's choice (cookie) → browser → fr. Done 2026-11-15: `sessions.ui_language` (migration `0018_ui_language.sql`, written best-effort so the app works before it is run; shown in the admin session header). Left: the API source (phase 2).
- [x] **L-04** Feedback translation: generalize `analysis-translation.ts` from "French" to "the session's `ui_language`" (skip when it equals the test language… or when it's `en`, the source). Keep the `analysis_fr` column readable for old sessions; new column `analysis_ui jsonb` + `ui_language`.
  Done 2026-11-15: `lib/analysis-translation.ts` translates into any interface language — French always (`analysis_fr`, client and admin), nl/es/it/de into `analysis_i18n`, in parallel at evaluation time; the dashboard translates on first view if the candidate switched language. Quoted passages (the candidate's words) are swapped for tokens before the call and restored after — the model was translating them; one retry on a wrong shape. Checked live on 10 calls across 5 languages. Not done: the end-of-test results screen does not re-translate if the candidate switches language there (falls back to English).
- [x] **L-05** Audio-description of the welcome page: a "Listen" button (decided 2026-11-15; no autoplay) reading the welcome text through the existing TTS registry in `ui_language`. Cache the audio per language (static files generated once, like `tts-samples/`) rather than calling TTS for every candidate. Done 2026-11-15: `scripts/generate-welcome-audio.ts` writes `public/audio/welcome/<lang>.mp3` (~37 s, ~220 KB each; Gradium for fr/en/es/de, Azure for nl/it) and the text hashes in `lib/welcome-audio.json`; `components/WelcomeListenButton.tsx` under the lead. **Re-run the script after any change to the welcome texts**: until then the button is hidden for that language rather than reading old text.
- [x] **L-06** nl-NL as a test language. `ConvLang` is used in ~30 files and `L10n` would force a Dutch-NL string on every bank question. Decided 2026-11-15: add `nl-NL` to `ConvLang` and let the bank fall back to the `nl-BE` text (standard Dutch, same questions); what differs is the prompt (no Belgian vocabulary rule), the TTS voice, the STT/Azure locale (`nl-NL`) and the label/flag. Go through the 30 files listed by `grep -rl nl-BE lib app components`. Done 2026-11-15: `bankLang()` maps nl-NL → nl-BE for bank texts (`L10n` is keyed by `BankLang`, so the compiler catches a missed lookup); own prompt branch (no Belgian vocabulary, same fixed intro); Azure voice `nl-NL-FennaNeural`, Azure locale `nl-NL`; STT on Voxtral `nl` as nl-BE; "Nederlands · NL · NEDERLAND" in the picker, 🇳🇱 in the dashboards. Migration `0019_nl_nl.sql` widens the language checks on `profiles.last_language` and `conversation_settings.language`. Not done: a full simulated session (the simulator currently fails in every language on the learner call, "Mistral: empty response").

## Phase 2 — integrator API

Follow [`api-plan.md`](api-plan.md), with these additions from the roadmap:

- [ ] **API-02b** Add to the spec (`doc/api/openapi.yaml`) and to the questions for the integrator: `interface_language` and `test_profile` (client or domain, phase 3) in `POST /tests`; `report_url` and the detailed scores in the result. Republish `/api-docs`.
- [ ] **API-04b** Migration: `test_profile` on `sessions` — done in 0020 (`sessions.test_profile`); the API migration is now `0021_api_tests.sql`.
- [ ] **API-06b** The result snapshot carries `report_url` (phase 5) and the feedback in the interface language (L-04).
- [ ] **API round 2** (2026-11-17): the integrator's review of the spec + every detail behind the score — proposals, decisions to take and tasks API-19…31 in [`api-plan.md` §Round 2](api-plan.md#round-2--integrator-review-and-score-details-2026-11-17).
- [x] **Reception screen** — decided 2026-11-18 (Baptiste): it lives in ELAO Speaking. It is our instructions + mic-check screen, with more about the test (duration, language, result A0–C2, what to prepare). A link that sets the test (`?lang=`, later the API's `?test=<id>`) lands straight on it, language locked, skipping welcome / account / language. Done for `?lang=` 2026-11-18; API-11 reuses it.

## Phase 3 — per-client questions (Safran)

- [x] **P-01** Test profiles, decided 2026-11-16 (Baptiste): in the database and editable in `/admin/profiles` (migration 0020: `test_profiles`, `test_profile_questions`), not in code. A question has a level RANGE (min–max) instead of one level; English only for now (the profile's language field). Safran seeded with the 12 questions, ranges proposed in the chat and approved in principle: A2–B2 (know Safran), B1–B2 (aerospace interest, international company, difficult problem, innovative product, first weeks), B1–C1 (why Safran, skills), B2–C1 (explain the business, multicultural teams, convince a candidate, industry challenges).
- [x] **P-02** Forced questions: at least `min_questions` per test (3 for Safran, editable per profile). A profile question is asked when the turn's target level is inside its range, in the profile's order, at most one every other turn; from `SESSION_MIN_SECONDS − 60 s` a missing one is asked even out of range (closest range first), and the session does not close before they are all asked (up to `SESSION_MAX_SECONDS`). Rules: `lib/test-profile-types.ts`, examiner hookup: `lib/examiner-prompt.ts`. The reply on a profile turn is built by code (pivot + the question word for word, `profileQuestionReply`): asked through the prompt, the model (mistral-small) skipped it in 29 of 36 tries. A "didn't understand" re-asks it (simpler version if written).
- [x] **P-03** `?profile=<id>` on the test link; stored in `sessions.test_profile`, shown on the admin session page. From the API later (API-02b).
- [ ] **P-04** Domain profiles (medicine, architecture, IT, call-centre): same mechanism, content to write later — not in this round.

## Phase 4 — audio pipeline

Live STT is already Voxtral (Track O). Deepgram is still used in pronunciation: `deepgramVerbatim` in `lib/pronunciation/providers/azure-ensemble.ts` (the second hearing judged by Mistral) and in `azure-intended`.

- [x] **A-01** Replace `deepgramVerbatim` with a Voxtral verbatim transcription (`lib/stt/providers/voxtral.ts`), keeping Azure Pronunciation Assessment on top. Prompt Voxtral for a verbatim (non-cleaned) transcript, since that hearing is there to catch mispronunciations. Done 2026-11-15: `lib/pronunciation/verbatim.ts` holds the second hearing with three engines — `deepgram` (still live), `voxtral-transcribe` (transcription endpoint) and `voxtral-chat` (Voxtral told to write what it hears, errors included). Picked by `PRONUNCIATION_VERBATIM_ENGINE`; neither Voxtral engine gives per-word confidence, and the judge prompts now say what to do without it. Switching live waits for A-02.
- [x] **A-02** Before switching live: run the replay over stored sessions (`scripts/asr-disagreement.ts` / `stt-replay.ts`) and compare pronunciation scores old vs new on the same audio, per language. Note the shift for the level floors. Run 2026-11-15 (`scripts/verbatim-replay.ts`, reports in `sim-runs/verbatim-replay-*`): 66 turns, fresh Deepgram as the reference, run-to-run noise of the judge itself |Δ| 3.7. `voxtral-transcribe`: mean −0.7 overall (fr +0.4, en +2.1, es −2.6, de +2.0, it +2.5 on 2 turns); nl-BE −5.3 on 2 sessions, then −1.8 (|Δ| 2.9) on the 3 nl-BE sessions with audio. `voxtral-chat`: −2.7, less stable (es −6.2, de |Δ| 10.3) — dropped. **Recommendation: `voxtral-transcribe`, no level-floor change needed.** Switch = `LIVE_VERBATIM_ENGINE` default in `lib/pronunciation/verbatim.ts` (or `PRONUNCIATION_VERBATIM_ENGINE` on Vercel). Go from Baptiste 2026-11-16: `voxtral-transcribe` is the code default (env var unset on Vercel); `deepgram` stays as a rollback engine.
- [x] **A-03** Clean up: `DEEPGRAM_API_KEY` out of `.env.example`, `session-cost.ts` (Deepgram line → Voxtral), labels in `system-config.ts`, stale comments (`audio-player.ts`, `session-recorder.ts`). Done 2026-11-16: `.env.example` documents `PRONUNCIATION_VERBATIM_ENGINE` instead; the cost line follows the live engine; comments, labels and README updated. `DEEPGRAM_API_KEY` can come off Vercel once the switch has run a few days without a rollback.
- [x] ~~**A-04**~~ Dropped 2026-11-16 (Baptiste): Silero stays the live turn detection (`LIVE_TURN_VAD_MODE` in `lib/turn-vad.ts`, already the default); Michel agreed. No comparison.

## Phase 5 — end-of-test report

Reframed 2026-11-16 (Baptiste): Michel does not want ELAO Speaking to show a Speechace-style report. He wants the API to give his own platform enough data to build its report. Our results screen is the test bench: try what is worth showing there first, then decide what the API sends.

- [x] **R-01** Framing: ELAO vs Speechace side by side. Gap list written 2026-11-16 (Claude Doc "Rapport de fin de test : écarts avec Speechace", https://claude.ai/artifact/ELzL8PZHVUToXbhAnq4KHU) — now background only; Baptiste took the decisions below instead of Michel.
- [x] **R-03a** Scores: keep the 4 axes, shown on 100 (display only, 7.5 → 75; the composite is unchanged). Done 2026-11-16 in `CefrPanel`.
- [x] **R-03b** Analysis: a few words per axis above the existing feedback — `axis_feedback` (4 strings) from the final evaluator, prompt v10; the pronunciation line gets the session's most-missed words (`weakPronunciationWords`). Translated with the rest. The general appreciation (`summary`) stays; it becomes `general_summary` in the API. Done 2026-11-16.
- [ ] ~~**R-03c**~~ Per-answer assessment: not done (Baptiste, 2026-11-16). Per-answer facts we already store (pronunciation score, WPM, question level, level-judge verdict, response time, help buttons) stay available for the API.
- [ ] **R-02** Report page `app/report/[id]` reachable without an account through a signed token — only if the API needs a report link; to decide with the API output.
- [x] **R-05** API output for the report: map what the results screen shows (4 axes on 100, `axis_feedback`, `general_summary`, strengths / to improve / errors, in the interface language) into the result snapshot (`doc/api/openapi.yaml`, API-06b). Spec done 2026-11-16: `axis_feedback`, `general_summary` (was `summary`), feedback in `en` + `fr` + the interface language, `interface_language` on tests and results, `nl-NL`; per answer in `full`: `judge_verdict`, `speaking_rate`, `word_scores`, `answer_seconds`, `help`. Still no score per answer. Code follows with phase 2.

## Waiting on Michel

1. Mistral API key (Q-01).
2. ~~Where the call-reception screen lives~~ — ours (2026-11-18).

## Log

| Date | Done | Blocked | Next |
|---|---|---|---|
| 2026-11-12 | Plan written from the roadmap doc; set up as the tracker; branch `roadmap-nov-2026` | Q-01 (Mistral key from Michel) | Q-02 |
| 2026-11-12 | Q-02, Q-03, Q-04; C2 replay for Q-05 | Q-01 (key); Q-05 (what "C2 back" means, check the 5 sessions) | Q-05 once decided, else phase 1 (L-01) |
| 2026-11-13 | Q-05: C2 reported again (decision: Baptiste) | Q-01 (key) | Phase 1: L-01 (interface languages list) |
| 2026-11-15 | Pushed `roadmap-nov-2026`. Phase 1 decisions (UI langs, nl-NL reuses nl-BE, Listen button). L-01; L-02 for the test flow | — | L-02: login, results-saved, dashboard |
| 2026-11-15 | L-02 done (account pages, cookie) | — | L-03 column, then L-04 (feedback in the interface language) |
| 2026-11-15 | Interface-language menu + browser-language default | Migration for L-03 (waiting for go-ahead: shared dev/prod DB) | L-03 column, L-04 |
| 2026-11-15 | L-03, L-04 | Migration 0018 to run in the Supabase SQL editor (Baptiste) | L-06 (nl-NL) |
| 2026-11-15 | L-06, Q-04 check | Migration 0019 to run in the Supabase SQL editor (Baptiste); simulator broken on the learner call | L-05 (Listen button) |
| 2026-11-15 | L-05 — phase 1 done | Native review of the 6 interface languages and the narrations | Phase 2 (API) / phase 4 (Voxtral) |
| 2026-11-15 | Mistral model pin (hotfix), A-01, A-02 replay | Production: `mistral-large-latest` became a reasoning model and broke evaluation + pronunciation judge; fix `25bc1ba` not on master yet; check `MISTRAL_MODEL` on Vercel | Go for `voxtral-transcribe`, then A-03 |
| 2026-11-16 | Model pin cherry-picked to master (`3faccb0`, pushed: `MISTRAL_MODEL` unset on Vercel, so prod was on the reasoning model). Go for Voxtral: `voxtral-transcribe` is the code default (A-02). A-03 | Voxtral reaches production only when this branch is merged (needs migrations 0018 + 0019 first) | A-04 (VAD lab comparison) |
| 2026-11-16 | Branch merged to master (`daef876`, build OK). Migrations 0018 + 0019 applied to the shared DB (constraints checked) | — | Prod smoke test; A-04; R-01 |
| 2026-11-16 | A-04 dropped (Silero stays). R-01 gap list written for Michel | Michel's decisions A–F on the report | R-02 (report page + signed link) can start; content waits for A–F |
| 2026-11-16 | Phase 5 reframed (report = test bench for the API). R-03a (axes on 100), R-03b (`axis_feedback`, prompt v10) | — | R-05 (report fields in the API spec) |
| 2026-11-16 | R-05: API spec carries the report details (axis feedback, general summary, interface language, per-answer words / rate / help) | Phase 2 code still waits on the integrator (API-02) | Send the updated spec to the integrator |
| 2026-11-16 | P-01 to P-03: test profiles in the DB + `/admin/profiles`, Safran seeded (migration 0020 applied), forced questions with level ranges, `?profile=` | Safran ranges to confirm with Michel; the examiner model also skips standard C1 bank questions half the time in a synthetic check (mistral-small) | Test a Safran session (`/?profile=safran`, English) |
| 2026-11-17 | API round 2 planned: integrator review (webhook format, levels without "+", required fields, retries, signature, cancel/expiry/abandoned, `evaluating`) + score details (`scoring` block) — `api-plan.md` §Round 2 | Decisions ☐ in §Round 2 (Baptiste; questions 1–4 for Michel) | API-19, then the spec |
| 2026-11-18 | Reception screen decided (ours). `?lang=` lands on the instructions + mic check, language locked; that screen shows duration, language, result and what to prepare (6 languages) | Native review of the new strings | API-11 on top of it |
