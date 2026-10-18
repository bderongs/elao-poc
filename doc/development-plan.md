# ELAO Speaking — development plan

Updated 2026-10-14. **Open work only**, grouped by theme. The history, findings and finished tasks are in [`client-feedback-plan.md`](client-feedback-plan.md); the old task ID is given in brackets (e.g. *was Z-10*) so each item can be traced back there.

★ = priority.

## Priorities

1. ★ **4.1** Is the level over-estimated at A2–C1? Confirm with real speakers.
2. ★ **5.1** The pacing judge is too generous from B1 up: B1 learners reach C2 questions.
3. ★ **2.1** Truncated and clipped transcripts.
4. **3.1** A1 questions a real beginner understands.
5. **1.1** Live check of the new turn-taking and of the reply guard.

## Where things stand

| Area | Live today |
|---|---|
| Session length | Adaptive, 3–7 min: stops once the difficulty ladder has settled (`SESSION_LENGTH_MODE = "adaptive"`, `lib/session-length.ts`). |
| Questions | Curated bank in 6 languages (`lib/question-bank/`). Code picks the question at A1, C1 and C2; the model picks from a slice at A2–B2. Warm-up first. A question is dropped after a second "didn't understand". |
| Examiner reply | A reply with no question, or the same question again, gets one corrective regeneration before it is spoken (`lib/examiner-guard.ts`, logged as `chat_reply_repaired`). Formal address kept throughout. |
| Pacing judge (ET) | Writes a one-sentence reason, then its verdict (`lib/level-assessment.ts`). This fixed the A1 trap, where C1/C2 speakers starting at A1 were held on A1 questions. |
| Speech recognition | Mistral realtime in all 6 languages, Voxtral batch as fallback, cross-check on suspiciously short transcripts. |
| Turn-taking | Energy VAD with a learned noise floor, pause budget by level (longer at A1/A2 and C2). |
| Scoring | Mean of the 4 axes ×10 → +5 % if ≥ 2 axes ≥ 9 → C2 floor at 90. Fluency held to the WPM table. Axes in half points. One or two likely recognition errors forgiven for strong speakers. Computed on read, so every stored session displays with today's rules (`SCORING_RULES`, `lib/cefr-score.ts`). |
| Tools | Simulation matrix `npm run sim:matrix` (language × level grid, see 4.2), one-level simulator `npm run sim:batch`, scoring replay `npm run analysis:scoring` (`analysis/README.md`), STT tools in `scripts/`. |

### Latest simulation matrix (2026-10-12)

The matrix covers 6 languages × 6 levels × 3 sessions. The latest run is `sim-runs/matrix-2026-10-12T19-10-56/` and the baseline before the fixes is `matrix-2026-10-12T15-55-27/`. Open `matrix.html` in either folder for the clickable grid. All sessions are in the database with `source = 'simulation'`; filter on `simulation_json->>'batchId'`.

| | A1 | A2 | B1 | B2 | C1 | C2 |
|---|---|---|---|---|---|---|
| **fr** | ✅ | 🔴 | 🔴 | 🟠 | 🟠 | ✅ |
| **en** | ✅ | 🟠 | 🔴 | 🟠 | 🟠 | ✅ |
| **nl-BE** | 🟠 | 🔴 | 🔴 | 🔴 | 🟠 | ✅ |
| **es** | 🟠 | 🔴 | 🔴 | 🟠 | 🟠 | ✅ |
| **it** | 🟠 | 🟠 | 🔴 | 🔴 | 🟠 | ✅ |
| **de** | 🟠 | 🟠 | 🟠 | 🟠 | 🟠 | ✅ |

- **The ends are right:** A1 and C2 get the right level in every language.
- **The middle is over-estimated:** final levels at A2–C1 come out about +2 labels too high (one full level), in every language. B1 is the worst cell. See 4.1.
- **The ladder climbs too fast:** every B1/B2 learner reaches C2 questions by answer 6–7. See 5.1.
- **Fixed by the 2026-10-12 changes (`b782996`):**
  - C1/C2 sessions stuck on A1 questions: 11/36 → 0/36.
  - Turns with no question or a repeated question: 14 → 4 of ~750.
  - Formal-address slips and "yes or no?" add-ons: 5 → 0.

---

## 1. UX & avatar interaction

### 1.1 Live check of the new turn-taking and reply guard *(was Y-08)*
Built on 2026-10-11 and 2026-10-12, never tested live. Turn-taking now has:
- a learned noise floor, with short bursts merged (quiet mics);
- a longer pause budget at A1/A2 (beginners were cut mid-answer);
- "listening" shown when the avatar's voice ends, not after the TTS padding;
- a remembered level that only applies in its own language.

The reply guard (`lib/examiner-guard.ts`) is also new.

Checks:
- [ ] One session on a quiet mic: answers end normally.
- [ ] One A1/A2 session with hesitant answers: no cut at a thinking pause.
- [ ] One session answering fast right after a short question: the answer is taken.
- [ ] Watch for the opposite failure: room noise starting turns once the noise floor has adapted.
- [ ] One A1 session answering "je ne comprends pas" twice. Léa should re-ask in different, simpler words, then move to a new subject, never the same question three times. Look at `chat_reply_repaired` in the logs. Like 2.1, those logs are not kept on Vercel, so test locally.

### 1.2 Client sign-off on the landing copy *(was AC-10)*
The landing now says "Votre niveau en quelques minutes" instead of the client-approved "Votre niveau en 3 minutes", because sessions are 3–7 min.
- [ ] Confirm the wording with the client.

---

## 2. Speech recognition

### 2.1 ★ Truncated and clipped transcripts *(was Z-10)*
Mistral's realtime stream sometimes ends "done" with half an answer (3 of 35 turns on 10-01). The cross-check catches answers ≥ 8 s at < 70 wpm, and swaps in the batch transcript when it has ≥ 20 % more words. It does not cover small tail losses (5–6 words) or a clipped first word ("Our chest" for "At chess").
1. [ ] **Make it measurable in production.** The `turn_stt_truncation_check` event only reaches `logs/` files (not kept on Vercel) and short-lived console logs. Store the STT facts on each answer instead:
   - an `stt` field on user turns in `sessions.transcript` (`TurnMeta` in `lib/sessions-service.ts`; jsonb, no migration);
   - fields `path` and `spokenMs`, plus `realtimeWords`, `batchWords` and `usedBatch` when the check ran;
   - a badge on the admin transcript.

   Store the reply-guard repairs the same way (1.1).
2. [ ] **Count** over ~20 real sessions with long answers: how often the check fires, and how often batch wins. Add a new section in `scripts/asr-disagreement.ts`.
3. [ ] **Find what it misses:** run `npx tsx scripts/asr-disagreement.ts --since 2026-10-11` and list turns where Deepgram hears ≥ 5 more words at the end and the check didn't fire.
4. [ ] **Decide** from steps 2–3. If tail losses are frequent, add a trigger that doesn't depend on wpm: the last realtime word well before the VAD's last voice frame, or always cross-check answers ≥ 15 s. Measure the added wait first, since the batch call delays the next question.
5. [ ] **Clipped first word:** replay a clipped turn's WAV with `scripts/stt-replay.ts --pace realtime`.
   - First word present → our pipeline loses frames before the socket is ready (log VAD start vs socket ready).
   - First word missing → it's Mistral's onset handling; try a longer pre-roll.

### 2.2 Gradium re-test — only before re-enabling it *(was Z-08)*
- [ ] Stream the stored turn WAVs through `lib/realtime-stt-gradium.ts` with and without extra lead-in audio (onset-clipping hypothesis). Repeat on one FR session and one low-level learner.

---

## 3. Questions & conversation content

### 3.1 A1 questions a real beginner understands *(was AF-06b, AF-02)*
Matrix of 2026-10-12, A1 row (18 sessions, 6 languages):
- **Final level is right:** A0–A1+, with one A2.
- **The ladder stays low:** it no longer climbs past A2.
- **Comprehension is still short of the target:** 32–83 % of questions fully understood (en 83 %, the others 32–53 %), and 4–18 % not understood at all.

Do these questions also suit **real** beginners? Baptiste's real A1 sessions (es, de) show a lot of French mixed in, and single-word answers.
1. [ ] **Opening turn.** At an A1/A2 start, if intro + warm-up is still > ~12 words, cut it to one sentence. The first question was not fully understood in 0–100 % of sessions depending on the language (it 100 %, fr/de 67 %).
2. [ ] **Closed and choice questions.** Rewrite the A1 entries that are still open ("Parlez-moi de…") as choice or yes/no questions ("Vous habitez dans une maison ou un appartement ?"), in 6 languages.
3. [ ] **Check the simulated learner.** Read ~10 "partly understood" cases. If a real A1 would have understood them, the learner prompt is too strict. Also make it fall back on its native language more often, as real beginners do.
4. [ ] Re-run the A1 row: `npm run sim:matrix -- --levels A1 --runs 3`.
- **Proposed targets:**
  - first question fully understood ≥ 80 %;
  - not understood ≤ 5 %;
  - final level A1 or A1+ in ≥ 9 of 10 sessions;
  - no question above A2.

### 3.2 Native and client review of written content *(was S-03, AA-07, AF-03)*
Written in FR/EN and translated in the same pass; never checked by a native speaker.
- [ ] Native review (nl-BE, es, it, de) of:
  - the question bank;
  - the A1 fixed follow-ups;
  - the pivot and bridge phrases (`PIVOT_WORDS` / `BRIDGE_PHRASES` in `lib/conversation-prompts.ts`), including the 2026-10-12 change "Sagen Sie mir," → "Sagen Sie mal,".
- [ ] Client review of the FR/EN bank on `/admin/question-bank`.

### 3.3 Conversation naturalness
Read through 108 sessions (2026-10-12). Topics are varied and well chosen, and no session got stuck on one subject. What still feels mechanical:
- [ ] **Reactions.** Léa answers every turn with a stock phrase ("Je vois.", "Got it.", "Zeker.") and never reacts to what was said. This is deliberate: the prompt forbids echoing or praising. Ask the client whether a very short reaction to the content is wanted ("Climbing — nice."). See question 7 below. If yes, it is a prompt change plus a matrix re-run.
- [ ] **Bare "Why?" at C2.** 15 of 123 C2 turns were only "Warum?" / "Pourquoi cela ?" / "Can you say more?". As a follow-up that's fine, but it spends a C2 turn without a C2 question. Rewrite the C2 bank follow-ups into specific ones that test C2 (`lib/question-bank/c2.ts`).
- [ ] **A repeat the guard can't fix.** When the question is already minimal ("Vous travaillez ou vous étudiez ?"), the regeneration may still return it unchanged. Only worth fixing if it shows up live.

---

## 4. Assessment quality

### 4.1 ★ Is the level over-estimated at A2–C1?
**Simulation:** final levels for A2–C1 learners come out about +2 labels too high, in all 6 languages. For example, a B1 learner gets B2/B2+. This holds with the synthetic audio and without it (text-only). The evaluator scores the text axes (fluency, vocabulary/grammar, communication) at about 7–8 for a B1 learner. Even a pronunciation score of 0 would only bring that down to A2+/B1, so the audio axis cannot explain it.

**Real sessions with a known level:**

| Speaker | Known level | App's level today | Gap |
|---|---|---|---|
| Baptiste, French | C2 | C2, C1+, C1+ | −0.7 label |
| Baptiste, English | C1 | C1+, C2, C1, C1, C2, B2 | +0.5 |
| Baptiste, Spanish / German | A1 | A0, A0, A1 | −0.5 |

At C1 the simulation runs about 1 label higher than reality, because simulated speech is cleaner than real speech. Even allowing for that, B1 would still be about one level too high. There is no real data at A2–B2 yet.
1. [ ] **Collect 6–10 real sessions** from speakers with a known level of about A2, B1 and B2, in any language. Beta testers or recruited learners both work; note each person's level in the session or in this file.
2. [ ] **Compare** the app's level with the known level, and look at which axis is generous: open the sessions in `/admin`, or use `npm run analysis:scoring -- --source conversation`.
3. [ ] **If confirmed:** calibrate the evaluator prompt (`lib/cefr-prompt.ts`) with what an A2/B1/B2 answer looks like on each axis, bump the prompt version, and re-run the matrix. Target: ✅ assessment on every A2–C1 cell, and real sessions within ±1 label.
4. [ ] **If not confirmed:** the simulated learner is too fluent at A2–B2. Make it messier (hesitations, more errors, false starts) so the matrix stays usable.

### 4.2 Simulation matrix — tooling *(new 2026-10-12)*
`npm run sim:matrix` (`scripts/sim-matrix.ts`) plays 3 sessions per language × level: 108 sessions, about 3 h, limited by the Mistral rate limit.
- **How a session runs:** the real examiner, the pacing judge (ET), the topic tracker (TT), the stop rule and the final evaluator, against an LLM learner.
- **Audio:** synthetic pronunciation/WPM (`lib/sim-audio-proxy.ts`), with a text-only level reported next to it.
- **Grading:** a second LLM judges each conversation. Each cell is graded on conversation and on assessment.
- **Runs:** `--resume DIR` continues an interrupted run, and `--rejudge` re-runs only the judge.
- [ ] **The Anthropic key in `.env` is rejected (401).** Until it's fixed, the judge falls back to Mistral, which is lenient (mostly 4–5/5) and is the same vendor as the examiner. Once fixed, run `npx tsx scripts/sim-matrix.ts --resume sim-runs/matrix-2026-10-12T19-10-56 --rejudge`.
- [ ] **Admin: filter sessions by simulation run.** The sessions list only filters on Source = simulation, so add a run/label filter.
- [ ] **Re-run the full matrix after each change to the examiner, ET or evaluator.** The latest run is the reference.

### 4.3 Half points: used, and what they change *(was AE-05)*
1. [ ] **Are they used?** Write a small report (`analysis/axes-usage.ts`, or `--axes-stats` on the replay): the share of axis values ending in .5 since 2026-10-05, per axis and per level. Fluency only counts up to 2026-10-08; after that it is set by the WPM table. If < ~10 %, strengthen the prompt rule and bump the prompt version.
2. [ ] **What do they change?** Add a knob `axisStep: 0.5 | 1` in `ScoringRules` and a `whole-axes` scenario (approximates the old whole-number behaviour), then run `npm run analysis:scoring -- --scenario whole-axes --since 2026-10-05`. With axis-mean live, each .5 moves the score by 1.25 points.
3. [ ] **Bonus threshold:** run `--scenario bonus-8.5` on the same set, and decide whether 8.5 should count for the +5 %.
4. [ ] Record the result in `analysis/README.md`.

### 4.4 Recognition-error forgiveness: effect on the level *(was AD-06)*
`scripts/forgiveness-replay.ts` shows the pronunciation average only, but pronunciation is now one of the four axes in the mean.
1. [ ] **Offline, pronunciation part.** Add a knob `pronunciationForgiveness: boolean` to the replay. It rebuilds each session's pronunciation average from the stored word verdicts (`session_turns.pronunciation_json`), with or without `applyPronunciationForgiveness`, and scores it. First check that a forgiven answer can be rebuilt unforgiven from what's stored; if not, apply it only to sessions before 2026-10-05. New scenario: `no-forgiveness`.
2. [ ] **Run** `npm run analysis:scoring -- --scenario no-forgiveness --evidence turns` on live sessions since 2026-09-17.
3. [ ] **Pass if** no session moves more than one step without a visible reason, and nothing with a rest-of-answer average < 85 moves. Listen to one or two sessions that get the +5 % only thanks to forgiveness.
4. [ ] **Evaluator part** (the allowance note, needs the LLM): add an eval-lab switch to run without the note, run 6–8 strong-speaker sessions both ways, and compare vocabulary/grammar and the errors quoted.
5. [ ] Record the result in `analysis/README.md`.

### 4.5 Evaluator still counts recognition errors as the speaker's *(was Z-03)*
The allowance note covers strong speakers only (pronunciation ≥ 85, ≥ 110 wpm, ≥ 100 words). Others still get "errors I didn't make" (NL tester), and a native's vocabulary/grammar stays capped at 8. Baptiste's French C2 sessions lost points to recognition errors counted as his ("s'allader", "paxé").
- [ ] After 4.4 step 4, decide whether to widen the allowance or strengthen the prompt's "dismiss recognition errors" rule for everyone. Bump the prompt version.

### 4.6 Calibrate the C2 floor *(was Track V)*
The floor (≥ 3 axes ≥ 9, none < 8, ≥ 5 answers, ≥ 20 words per answer) was calibrated on two sessions.
- [ ] Baptiste records 3–4 more French sessions, including concise answers. The client supplies one strong **non-native** control. Check that the floor lifts the natives and not the control (`--scenario no-floor`).

---

## 5. Level detection & session length

### 5.1 ★ The pacing judge is too generous from B1 up
Matrix of 2026-10-12: the judge rates 98–100 % of B1 and B2 learners' answers "well", even on C1/C2 questions. So every B1/B2 learner climbs one rung per answer and reaches C2 by answer 6–7. The stop rule then estimates "C2" for every learner from B1 up. A1 and A2 are fine, because climbing there needs "strong".
1. [ ] **Look at the judge's reasons** (it now writes one) on B1/B2 answers judged "well" at C1/C2 rungs. Find out what it rewards: length? fluency? or the rung's actual demands, such as nuance, hypotheticals and precise vocabulary?
2. [ ] **Tighten "well" from B2 up.** The answer must show what the rung asks for: from B2, a developed opinion or comparison; at C1, weighing and precise vocabulary; at C2, nuance and reformulation. Being relevant and fluent should not be enough. Do this as rung-specific addenda in `lib/level-assessment.ts`, like the existing A1/A2 and C2 ones.
3. [ ] **Validate:** re-run the B1/B2 rows (`--levels B1,B2`) to check the highest rung stays at most 1 above the learner. Re-run the C1/C2 rows so that strong speakers still reach C2 quickly (see 5.2).

### 5.2 Faster promotion for strong speakers *(was AB-04, Track V)*
"Well" = +1 rung whatever the answer's real level, and French starts at A2, so a native reaches C2 at the 5th question at best. Do this together with 5.1, since a stricter "well" must not slow natives down.
- [ ] The pacing judge also estimates the level the answer itself shows, and jumps ≥ 2 rungs when it is clearly above the current one. Guard this with evidence: ≥ ~20 words counted in code, subordination or idiom. Optionally wait ~400 ms for the judge on the first 2–3 turns.
- [ ] Validate on stored ladders and on the matrix's C1/C2 rows: strong sessions jump early, weaker ones don't.
- Not recommended: `step_size = 2` (it also drops 2 rungs on a bad answer), or starting French at B1 (weaker candidates lose turns coming down).

### 5.3 Calibrate the adaptive stop rule *(was AC-08)*
The thresholds come from one session (`0d381874`, which would have stopped at 4:42 with the same final level). The matrix shows the rule works, but its estimate is only as good as the ladder: today it says "C2" for every B1+ learner (5.1).
- [ ] After 5.1, collect ~15–20 real sessions at different levels and compare "would stop at" with the final level in the admin ladder panel. Runs to 7 minutes need `SESSION_LENGTH_MODE = "shadow"` locally, because `?minutes=` is ignored in adaptive mode.

---

## 6. Integrations

### 6.1 Score callback — to configure *(was AG-01)*
Built, not activated (`lib/score-callback.ts`, shown on `/admin/system-config`).
- [ ] Get from the client:
  - the receiving URL;
  - the payload fields;
  - authentication (HMAC signature or bearer token);
  - the events;
  - whether they need their own user reference on the test link.
- [ ] Set `enabled: true`, `SCORE_CALLBACK_URL` and `SCORE_CALLBACK_SECRET` in Vercel, then run one real session and check delivery.

### 6.2 Email + password accounts — Supabase settings and live check *(new 2026-10-14)*
Magic links are gone. `/login`, the welcome screen and the post-session claim card all use one form (`components/AuthForm.tsx`) with a "Se connecter" tab and a "Créer un compte" tab (email, password, confirmation, at least 8 characters). Admin login keeps password only. "Mot de passe oublié" sends a reset email: `/login/forgot` → `/auth/callback` → `/login/reset`.
- [ ] In the Supabase dashboard (each project), go to Authentication → Providers → Email: turn **"Confirm email" off** and set the minimum password length to 8. If confirmation stays on, sign-up shows "Vérifiez vos emails" instead of logging in.
- [ ] Check that `<site>/auth/callback` is in Redirect URLs for local and Vercel. The reset email depends on it.
- [ ] Optional: translate the "Reset password" email template into French.
- [ ] Live check: sign-up, then sign-out and sign-in, the claim from the results card (`sessions.user_id` set), the reset email, and `/?level=B1` surviving sign-in.
- [ ] Tell existing users: accounts created by magic link have no password. They use "Mot de passe oublié" once, or an admin sets one in `/admin/users`.
- [ ] Later: Google sign-in. The button is already there but disabled. Enable the Google provider in Supabase (Google Cloud OAuth client) and set `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true`.

---

## 7. Open questions for the client

1. Should the warm-up answer count in the evaluation?
2. "Feedback given at the end of the session" in admin = the written evaluation (strengths, weaknesses), not the avatar's spoken closing — correct?
3. Landing copy "Votre niveau en quelques minutes" (1.2).
4. Scoring: are they aware of, and OK with, the +5 % bonus and the C2 floor that uses words per answer as a gate?
5. Question bank review (3.2).
6. Score callback details (6.1).
7. Should Léa react briefly to what the speaker said ("Climbing — nice.") instead of only neutral acknowledgements (3.3)?
8. Can they provide a few testers with a known level around A2, B1 and B2 (4.1)?
