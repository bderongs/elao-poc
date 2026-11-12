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

## Status mapping

| API status | `sessions` row |
|---|---|
| `created` | `status = 'created'` (new value), inserted by `POST /api/v1/tests` |
| `in_progress` | `status = 'in_progress'` — set at the first answer, as today. Abandoned tests stay here. |
| `completed` | `status = 'completed'` and `result_snapshot` not null |
| `error` | `status = 'completed'` and `evaluation_json` null (the save already goes through when the evaluation fails) |

## Steps

### 1. Contract

- [x] **API-01** Draft OpenAPI spec: [`api/openapi.yaml`](api/openapi.yaml). Lints clean with `npx @redocly/cli lint doc/api/openapi.yaml`.
- [ ] **API-02** Send it to the integrator; settle the open questions below. Only then start step 2.

### 2. Database

One migration (`0018_api_tests.sql`), additive only — the DB is shared between dev and prod.

- [ ] **API-03** `sessions.status` check: add `'created'`.
- [ ] **API-04** New columns on `sessions`: `external_ref text`, `redirect_url text`, `completed_callback_url text`, `start_level text`, `via_api boolean not null default false`, `started_at timestamptz`, `completed_at timestamptz`, `result_snapshot jsonb`.
- [ ] **API-05** `lib/session-status.ts` and the admin list: a `created` row is "Not started"; hidden from the list by default, with a "Tests API" filter (`via_api`).

### 3. Result snapshot

- [ ] **API-06** `lib/api-result.ts` (new): `buildResultSnapshot(session, rules)` → the `full` result of the spec (level/score from `computeCompositeCefrScore` with `getLiveScoringRules()`, axes as in `buildScoreCallbackPayload`, feedback `en` + `analysis_fr`, turns from the transcript and the ladder, integrity summary). `summary` and `standard` are cuts of it.
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
2. Is French + English feedback right, or only French?
3. Do they need the audio in `full`? Left out of v1 (GDPR: retention period, a `DELETE /tests/{id}`).
4. Webhook, polling, or both? Is the HMAC signature fine on their side? Their receiving URL.
5. Expected volume (cost and rate limit).
6. Their production domain for `test_url`.
