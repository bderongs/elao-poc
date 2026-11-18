# Integrator API — dev plan (2026-11-09)

Source: call with the integrator. They want to order a test, get an id, poll its status, then read the result at more than one level of detail.

Contract: [`api/openapi.yaml`](api/openapi.yaml) (draft, to validate with the integrator — step 1).

## Decisions (Baptiste, 2026-11-09)

- **One client only.** One API key in an environment variable, no `api_clients` table.
- **No new table.** A test is a row in `sessions`, created by the API before the candidate opens the link.
- **Four statuses:** `created` | `in_progress` | `completed` | `error`.
- **Abandoned tests stay `in_progress`.** No server-side evaluation of a session the browser didn't finish, for now. ⚠ Today the evaluation is run by the browser (`/api/evaluate`, then `POST /api/sessions`): a candidate who closes the tab after the last answer is never scored, and the integrator will see that test `in_progress` forever.
- **The result is fixed at evaluation time.** Today the score is computed on read with the current rules (`SCORING_RULES` + the admin's level floors), so a stored session can change level when a floor moves. The API returns a snapshot written once and never recomputed. The admin keeps computing on read.
- **No link expiry.** The link works once: when the test is `in_progress`, opening it again shows "test already started".

## Round 2 — integrator review and score details (2026-11-17)

Source: the integrator's written review of the published spec (`/api-docs`), plus Baptiste's ask: the API must give **every detail behind the score**, following the result changes of 2026-11-13…16 (C2 reported again — Q-05; axes on 100 and `axis_feedback` — R-03).

Each line is a proposal unless marked **Decided**; ☐ = still needs Michel's answer.

### API remarks

| # | Remark | Proposal | Tasks |
|---|---|---|---|
| R2-1 | Webhook `result` ≠ `summary` result (no `language`, `detail`, `completed_at`, `duration_seconds`, `answer_count`). | One format: the webhook's `result` **is** the `detail=summary` result object, same schema (`TestResult`), built from the same snapshot. Null for `test.error`. | API-20 |
| R2-2 | Levels inconsistent: reported stops at C1+, `start_level` accepts C2, `question_level` has no "+". ELAO uses A0–C2 without "+"; precision comes from each scale's own sub-levels. | `level`: **A0, A1, A2, B1, B2, C1, C2**, no "+" — the same list everywhere (`start_level`, `question_level` add nothing new; A0 is never a start level). C2 is reported again (Q-05), so the C1+ cap and `top_of_scale` go. Precision: `score` (0–100) plus `level_scale`, the score bands used for that test (frozen in the snapshot, since the floors are admin-editable), so ELAO maps the score onto its own sub-levels. Our "+" bands stay in our own screens only. **Decided (Baptiste, 2026-11-17): `level` without "+"; our split comes as a separate `detailed_level` (A1+…C1+), same bands, frozen in the snapshot.** **Then (2026-11-17): `detailed_level`, `confidence` and `level_scale` grouped under `advanced`, so the top level is just `level` + `score`; `integrity` moves there too. `advanced` is in `full` only: `summary` (and the webhook) and `standard` just give `level` + `score`.** | API-21 |
| R2-3 | Are `axes` and `feedback` optional in `standard`? When absent? | Make both **required** in `standard`/`full`. Inside: the three evaluator axes are always set; `pronunciation` is null only when no answer could be scored (every answer too short, or the pronunciation engine failed on all of them) — say so in the spec. Feedback: `en` and the interface language always present (no `fr` unless that is the interface language — **decided Baptiste, 2026-11-17: French not needed, the admin can read English**); a translation is retried, and if it still fails that language carries the English text with `translated: false` instead of null. `axis_feedback` always present (null only for pre-v10 evaluations, which API tests never are). | API-22 |
| R2-4 | 3 retries after 1 s and 2 s is too short; e.g. 30 s apart. | Yes, longer. **Decided (Baptiste, 2026-11-17): 3 retries, 1 min apart (attempts at 0, 1, 2, 3 min); the spec says to catch up with `GET /tests/{id}` after an outage.** (First proposal was 0, 1 min, 5 min, 30 min, 2 h, 12 h.) Can't live in `after()` (function time limit), so: a `webhook_deliveries` table (event id, test, URL, attempts, next try, last status) and a Vercel Cron every minute that sends what is due. Also gives the admin "delivery status + resend" planned in AG. | API-23, API-24 |
| R2-5 | Signature has no date or event id → a captured message can be replayed later. | Stripe-style: `X-Elao-Signature: t=<unix seconds>,v1=<hex>` where `v1 = HMAC-SHA256(secret, "<t>.<raw body>")`; the body carries `event_id` (stable across retries, so they can dedupe) and `sent_at`. Spec tells them: reject when `t` is more than 5 min off, ignore an `event_id` already seen. | API-25 |
| R2-6 | No cancel, no expiry: tests created but never taken (their create call lost), tests started and never finished. | **Decided (Baptiste, 2026-11-17): none of it** — no cancel, no expiry, no `abandoned`. A test the candidate leaves stays `in_progress`; ELAO creates a new one for a new attempt. Say so in the spec. | — |
| R2-7 | Between end of test and `completed` the test is `in_progress`: finished vs abandoned can't be told apart. Intermediate status, or max evaluation delay? | **Decided (Baptiste, 2026-11-17): `completed` = the conversation is over, `graded` = evaluated, result available.** The page tells the server the conversation is over before it evaluates. ⚠ Evaluation runs in the browser: a tab closed during it would leave the test `completed` for ever, so the cron also grades server-side any test `completed` for more than 5 min without a result (transcript and per-answer pronunciation are saved after each answer; `runCefrEvaluation` exists). Spec promises `completed` → `graded`/`error` within **15 min** (to confirm by measuring — API-29). Webhooks: `test.completed` (no result), `test.graded` (summary result), `test.error`. | API-28, API-29 |

Statuses: `created` → `in_progress` → `completed` → `graded` | `error`. A test left before the end stays `in_progress`. `completed_callback_url` keeps its name and receives all three webhooks.

### Score details (Baptiste)

**Dropped (Baptiste, 2026-11-17): no `scoring` block in the API** — an API client has no use for it. Kept below for reference; `level_scale` lives on under `advanced` (R2-2).

Today `full` gives the axes, the feedback and per-answer facts, but not **how the score was made**. Add a `scoring` block to `full`, frozen in the snapshot:

- `axes_evaluated`: the evaluator's three axes on its own 0–10 scale (half points) and the pronunciation engine's session average (0–100), before any rule.
- `axes_used`: the four values actually averaged (after the speaking-rate cap on fluency, etc.).
- `axis_mean`, `base_score` (axis mean through the axis curve), final `score`.
- `adjustments`: every rule that moved the number, typed — `{ rule, from, to, reason }`, rules `fluency_wpm_cap`, `c2_gate_cap`, `c2_by_evidence` (and the ones off today: `bonus`, `c2_floor`, `boundary_check`, `pronunciation_lift`, `pronunciation_weight`). Empty when nothing moved it.
- `evidence`: `answer_count`, `words_per_answer`, `speaking_rate` (session, wpm), `c2_answers_well`, `speaker_errors` (the counted errors, quoted).
- `level_scale` (same as R2-2) and `rules_version` (a short hash of `SCORING_RULES` + floors, so two results can be compared).

Code: `scoreWithRules` (`lib/cefr-score.ts`) returns only `notes` (free text). It gets a typed `adjustments` list next to them, and the intermediate values (`axisMean`, `baseScore`, the used axes). Notes stay for the replay reports. → API-30.

### Other questions (for Michel, not API)

Answers to give back, ☐ each one Michel's call:

1. **Failed evaluation / repeated abandonment.** The retry policy belongs to ELAO's platform (it creates the tests). Our part: `error` should be rare (server-side retry of the evaluation before `error`, API-28), and every attempt is a separate test, so ELAO can count attempts per `external_ref`. Suggestion: 3 attempts, then trainer grading.
2. **Deferred trainer score.** Possible from `full` (transcript, per-answer facts, feedback). If a trainer is to grade, the audio helps a lot. **Decided (Baptiste, 2026-11-17): yes** — in `full`, each turn gives `audio_url` (signed link to its `turn-<i>` recording, 2 h, re-signed on every call, never stored in the snapshot) and `audio_expires_at`. → API-32. ☐ Retention period still to agree with ELAO (GDPR: voice is personal data); until a purge exists, recordings are kept.
3. **What to show, where.** Their call. Correction to their note: feedback is no longer FR + EN only — it exists in the six interface languages (fr, en, nl, es, it, de; L-04). ☐ Proposal: always send all six, so ELAO picks at display time (5 small translation calls per test).
4. **Redirect vs display inside ELAO's page.** Still open. Inside an iframe works but needs: their iframe with `allow="microphone"`, our `Content-Security-Policy: frame-ancestors` listing their domain (API-31), and our page not relying on third-party cookies (API tests have no account step, so fine). Redirect needs nothing new (`redirect_url`).

### Round 2 tasks

- [ ] **API-19** Decisions above — taken 2026-11-17 (no "+"; no cancel/expiry/abandoned; `completed` then `graded`). Spec updated the same day; left: republish `/api-docs` and reply to the integrator.
- [ ] **API-20** Spec: webhook `result` = `TestResult` at `summary`.
- [ ] **API-21** Spec + snapshot: `level` A0–C2 without "+", `level_scale`, drop `top_of_scale`; `Level` enum shared by `start_level` / `question_level`.
- [ ] **API-22** Spec: `axes`, `feedback` required; nullability documented; translation retry + `translated: false` fallback.
- [ ] **API-23** Migration `webhook_deliveries` (+ in `0021_api_tests.sql`).
- [ ] **API-24** `app/api/cron/webhooks/route.ts` + `vercel.json` cron (every minute), protected by `CRON_SECRET`; retry schedule 0 / 1 / 2 / 3 min.
- [ ] **API-25** Signature `t=…,v1=…` over `"<t>.<body>"`, `event_id` in the body; spec section "Verifying a webhook" with a code sample.
- [x] ~~**API-26**~~ Cancel / expiry — dropped (Baptiste, 2026-11-17).
- [x] ~~**API-27**~~ `abandoned` status — dropped (Baptiste, 2026-11-17).
- [ ] **API-28** `completed` / `graded`: the page reports the end of the conversation (`PATCH /api/sessions/live { finished: true }`) → `completed` + `test.completed`; the final save writes the snapshot → `graded` + `test.graded`. The cron grades server-side what has been `completed` > 5 min without a result; two failures → `error`.
- [ ] **API-29** Measure evaluation time (end of conversation → final save) on recent sessions; set the documented maximum.
- ~~**API-30** `scoreWithRules`: typed `adjustments` + intermediate values; `scoring` block in the `full` snapshot and spec.~~ Dropped 2026-11-17.
- [ ] **API-31** If the iframe option is chosen: `frame-ancestors` header for ELAO's domain in `next.config.js`.
- [ ] **API-32** Audio in `full`: the snapshot keeps each turn's stored recording URL (path only, from `session_turns.audio_url`); `GET …/result?detail=full` signs them with `signRecordingUrls` (`lib/recordings.ts`) on each call → `audio_url` + `audio_expires_at`. Null when the turn has no recording. Later: retention purge once the period is agreed.

Order: API-19 first (decisions), then the spec (API-20…22, 25, 28 and 30 spec parts) and republish `/api-docs` — the integrator reviews the contract before any code. Then code with step 2 below; the migration (API-23, columns for the new statuses) joins `0021_api_tests.sql`.

## Status mapping

Updated 2026-11-17 (round 2: `completed` then `graded`).

| API status | `sessions` row |
|---|---|
| `created` | `status = 'created'` (new value), inserted by `POST /api/v1/tests` |
| `in_progress` | `status = 'in_progress'` — set at the first answer, as today. A test the candidate leaves stays here. |
| `completed` | `status = 'completed'`, `result_snapshot` null — the page reported the end of the conversation (API-28) |
| `graded` | `status = 'completed'` and `result_snapshot` not null |
| `error` | `status = 'completed'`, no evaluation, and grading given up (two failed tries, API-28) — needs a marker column, e.g. `grading_failed_at` |

### Test profiles in the API (Baptiste, 2026-11-17)

Client questions (roadmap phase 3, `lib/test-profiles.ts`) available to the integrator. Spec draft 3:

- `POST /tests` takes `profile` (a profile id). Refused with `400` if the profile is unknown or inactive (`unknown_profile`) or not for the test's language (`profile_language_mismatch`), unlike the `?profile=` link, which silently ignores a mismatch. `Test` echoes `profile`.
- No profile endpoint for now (Baptiste, 2026-11-17): profiles are agreed with ELAO and edited in `/admin/profiles`.
- `full` result: each `Turn` has `client_question` (boolean), true when it asked a profile question.

Tasks:

- [ ] **API-33** Migration (in `0021_api_tests.sql`): nothing new for the profile itself — `sessions.test_profile` exists (0020). The candidate link (API-11) passes the test's profile to the page instead of `?profile=`.
- [ ] **API-34** `POST /tests`: validate `profile` with `getProfile` (active + same language); store it in `sessions.test_profile`.
- [ ] **API-35** Snapshot (API-06): `client_question` per turn from `integrity_json` (each turn's `questionId` is already the profile question's id on a profile turn), true when it is one of the profile's question ids.

## Steps

### 1. Contract

- [x] **API-01** Draft OpenAPI spec: [`api/openapi.yaml`](api/openapi.yaml). Lints clean with `npx @redocly/cli lint doc/api/openapi.yaml`.
- [ ] **API-02** Send it to the integrator; settle the open questions below. Only then start step 2.

### 2. Database

One migration (`0021_api_tests.sql`; 0018 is the interface language, 0019 nl-NL, 0020 the test profiles), additive only — the DB is shared between dev and prod.

- [ ] **API-03** `sessions.status` check: add `'created'`.
- [ ] **API-04** New columns on `sessions`: `external_ref text`, `redirect_url text`, `completed_callback_url text`, `start_level text`, `via_api boolean not null default false`, `started_at timestamptz`, `completed_at timestamptz`, `result_snapshot jsonb`.
- [ ] **API-05** `lib/session-status.ts` and the admin list: a `created` row is "Not started"; hidden from the list by default, with a "Tests API" filter (`via_api`).

### 3. Result snapshot

- [ ] **API-06** `lib/api-result.ts` (new): `buildResultSnapshot(session, rules)` → the `full` result of the spec (level/score from `computeCompositeCefrScore` with `getLiveScoringRules()`, axes on 100 as in `buildScoreCallbackPayload`, feedback `en` + the interface language's (`analysis_fr` for fr, `analysis_i18n` otherwise), each with `axis_feedback` and `general_summary` (= the evaluator's `summary`); turns from the transcript (`pronunciation_json`: score, `wpm` → `speaking_rate`, words → `word_scores`), the ladder (`question_level`, `judge_verdict`) and `integrity_json` (`response_delay_seconds`, `answer_seconds`, `help`); integrity summary). `summary` and `standard` are cuts of it. Spec updated 2026-11-16.
- [ ] **API-07** Write it in the final save (`POST /api/sessions` → `createSessionFromForm`), for `via_api` rows only, together with `completed_at`. Never rewrite it afterwards.

### 4. Endpoints

- [ ] **API-08** `app/api/v1/tests/route.ts` (POST), `app/api/v1/tests/[id]/route.ts` (GET), `app/api/v1/tests/[id]/result/route.ts` (GET). Validation and errors as in the spec (`{ error: { code, message } }`). Only `via_api` rows are visible.
- [ ] **API-09** Auth: `Authorization: Bearer <API_KEY>`, constant-time compare (`timingSafeEqual`). `API_KEY` in `.env.example` and Vercel.
- [ ] **API-10** `middleware.ts`: `/api/v1/*` skips the admin cookie check (the routes check the key themselves); per-key rate limit via `lib/rate-limit.ts`.

### 5. Candidate link

- [ ] **API-11** `app/page.tsx`: read `?test=<id>` (same read-once pattern as `?level=`). A public endpoint returns the test's language and start level and whether it can still be taken; the language choice is locked to it.
- [ ] **API-12** `POST /api/sessions/live` with `testId`: instead of inserting, flip that row `created` → `in_progress` (atomic `update … where status = 'created'`), set `started_at`. A second opening finds no `created` row → "test already started" screen.
- [ ] **API-13** End of test: no account / claim step for API tests; go to `redirect_url` if set.

### 6. Webhook

- [ ] **API-14** `lib/score-callback.ts`: for `via_api` rows, send `test.completed` (summary from the snapshot) or `test.error`, with `test_id` and `external_ref`. URL: the test's `completed_callback_url` when set (it supersedes the default), else `SCORE_CALLBACK_URL`. Validate `completed_callback_url` at `POST /tests`: HTTPS only, and refuse hosts that resolve to private/loopback addresses (our server calls it). Same secret, `SCORE_CALLBACK_SECRET`, for both; set `enabled: true` once the integrator's receiver is ready (closes AG-01).

### 7. Admin and docs

- [ ] **API-15** Session detail: show `external_ref`, the API status and the webhook outcome.
- [ ] **API-16** `/admin/system-config`: API section (key set or not, base URL, link to the public docs at `/api-docs`).
- [ ] **API-17** End-to-end test against a local receiver: create → open link → finish → webhook → result at the 3 levels; reopen link; wrong key; result before completion (409).
- [ ] **API-18** README: the API in a few lines, `API_KEY` in the env table.

## Open questions for the integrator

1. Does the candidate see their result at the end, or go straight to `redirect_url`? (Proposed default: our results screen, then a button to `redirect_url`.)
2. ~~Feedback languages~~ — decided 2026-11-17: `en` + the candidate's interface language, no systematic `fr`.
3. Do they need the audio in `full`? Left out of v1 (GDPR: retention period, a `DELETE /tests/{id}`).
4. Webhook, polling, or both? Is the HMAC signature fine on their side? Their receiving URL.
5. Expected volume (cost and rate limit).
6. Their production domain for `test_url`.
