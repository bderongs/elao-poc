# Feature 2 — Response timing and light integrity signals

**Status (2026-11-03): built, needs migration 0016.**
- **Recording:** `lib/integrity-tracker.ts`, called from `app/page.tsx`.
- **Summary and settings:** `lib/integrity.ts`, `lib/integrity-settings-service.ts`, `/api/integrity-settings`.
- **Admin:** `components/IntegrityPanel.tsx` on the session page (badge plus detail), badge in the session list, settings card on `/admin/settings`.
- **Storage:** `sessions.integrity_json`, raw facts only. The none / low / high level is computed when a page is viewed, from the current settings.

Differences from the plan below:
- Thresholds use the level of each question (the rung it was asked at), not the candidate's final level.
- "Long pauses inside an answer" are not tracked. The voice detector ends a turn after a 1.2–4 s silence, so a pause of 3 s or more mostly ends the answer instead. Mid-answer hesitation is also normal in spontaneous speech.
- Also not counted: questions re-asked after a "didn't understand" (button or spoken), skipped questions (counted separately), and barge-ins (latency 0). The "Répéter" button restarts the clock.
- Time away before answering counts in the latency. Two or more questions with both time away and a long silence give "high" on their own.
- The "per client" switch is a single global switch: the app has no client or organisation concept yet.
- Not built: exports (the app has no results export) and a privacy-notice text (the app has no privacy page). The instructions screen mentions the recording when the feature is on.

## Problem
Some candidates relay the questions to an AI and wait for its answer before speaking. Michel (ELAO, 30 Oct 2026) suggests telling candidates to answer spontaneously and flagging assessments with repeated silences over 3 seconds. We also want a simple signal when a candidate leaves the test window.

This is a small check, not a proctoring tool: no camera, no screen capture, no automatic fail.

## Goal
Give reviewers a clear, explainable signal that a session may be suspicious, without penalising honest candidates (slow thinkers, low levels, nervous people).

## Non-goals
- No automatic score penalty or rejection.
- No video, screenshots or screen recording.
- No attempt to detect a second device (phone) — out of scope.

## Proposed behaviour

### 1. Instructions before the test
Add to the intro screen: answers must be spontaneous; long silences and leaving the test window are recorded and shown to the reviewer.

### 2. Response latency tracking
For each question, measure:
- **Latency:** time between the end of the avatar's question and the start of the candidate's speech.
- **Long pauses** inside an answer.

A "long silence" is a latency or pause above a threshold that depends on the level, with configurable defaults:

| Level | Threshold (default) |
|---|---|
| A0–A2 | 6 s |
| B1–B2 | 4 s |
| C1–C2 | 3 s |

Rules to avoid false positives:
- Ignore the first question (warm-up).
- Ignore the delay after the candidate presses "je n'ai pas compris".
- Ignore cases where the mic or avatar had a technical issue.
- Raise the signal only when long silences occur on at least 3 questions (configurable; Michel suggested 2–3).

### 3. Window / tab change detection
Listen to `visibilitychange` (primary) and window `blur`/`focus` (secondary, debounced).
- Record each event: timestamp, question in progress, time away.
- Ignore blurs under ~1 s (OS notifications, permission prompts).
- On return, show the candidate a short neutral message: "You left the test window. This is recorded." Show it each time, but never interrupt the avatar or end the test.
- The mic permission prompt at test start must not count.

### 4. Integrity summary for reviewers
Compute a simple level per session: **none / low / high**, with the reasons listed (for example "4 long silences on 12 questions", "3 window changes, 45 s away in total"). Show it in the admin results view next to the score, and in exports. The score itself is never modified.

### 5. Data and privacy
Store only events (type, timestamp, question id, duration) and the summary, no content. Mention it in the privacy notice and the intro screen (GDPR transparency). Allow the organisation to disable the feature per client if needed.

## Acceptance criteria
- Switching tab for more than 1 s creates an event with duration and shows the message when the candidate returns.
- Three questions answered after silences above the level threshold produce a visible flag in the admin view with the reasons.
- A candidate who presses "je n'ai pas compris" or has a technical issue is not flagged because of it.
- Thresholds and the number of questions required are configurable without a code change (config or admin setting).
- Test continues normally in all cases; no score changes.

## Risks / open questions
- A tab switch has innocent causes (notification, copying an access link); the flag must stay a hint, not a verdict.
- Thresholds are guesses until tested on real sessions: start in "log only" mode on Accent and Alliance Française pilots, then tune.
- Latency measurement depends on reliable end-of-question and start-of-speech detection, so it relies on the VAD from Feature 1.

## Test plan
Simulate: normal candidate, slow low-level candidate, candidate pausing 5 s after every question, candidate switching tab several times, candidate with a cough burst. Check flags and messages in each case.
