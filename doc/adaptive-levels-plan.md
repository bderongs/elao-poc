# Adaptive levels — feature request + plan

Status: **implemented 2026-09-10** (sections 3 and 4 below — ladder/C2
content, zone prompt deltas, VAD pause-awareness, and the `?level=` URL
override are all in the working tree). Not yet live-tested against real A1/
A2/C2 sessions — see §8. Companion to `doc/assessment_process.md` (read that
first for how A/ET/EO/STT fit together today — this document only describes
the delta on top of it).

## 1. The ask

Today's conversation and scoring are tuned for **B1 → C1** candidates and
work well there. Two gaps at the edges:

1. **Dedicated behaviour per level zone.** At **A1/A2**, the questions asked
   (and the follow-ups the model improvises) are probably too hard for a
   true beginner, and the assessment criteria used to judge them shouldn't
   be identical to a B1+ candidate's — we're not looking for the same
   things. At **C2**, questions are too easy: the ladder never actually asks
   C2-caliber questions, so a near-native candidate is never really tested.
   If we do ask harder questions, they naturally provoke longer thinking
   pauses, and today's pipeline risks reading a pause as a fluency problem
   ("blank" → "struggled") rather than normal cognitive load for a hard
   question — which would make things worse, not better, if we simply raised
   difficulty without also addressing that.

2. **Direct starting-level mode.** Once (1) exists, be able to drop a
   candidate straight into a given level zone via a URL parameter, instead
   of always starting at the A1 warm-up and climbing/descending from there.

Explicit constraint from the request: **this must not change the existing
B1–C1 behaviour.** It's an edge-case improvement, not a redesign.

## 2. How the system works today (relevant parts only)

- **Difficulty ladder** is `A1 → A2 → B1 → B2 → C1` — **C2 is not a rung**
  (`lib/cefr-rung.ts`). The final score (`lib/cefr-prompt.ts`) can still
  *label* a session C2, but the live conversation never asks C2-level
  questions; a near-native candidate spends the whole session being asked
  C1 questions.
- **One shared prompt** (`lib/conversation-prompts.ts`) drives the examiner
  for every rung. Per-rung differences today are limited to: which question
  bank slice is shown (`PHASE1..4` + C1's invent-only examples) and one
  target-rung line in `buildCommonRules`. Tone, pacing, the "press once on a
  short answer" rule, filler-word bans, etc. are identical across every
  level.
- **One shared pacing judge** (`lib/level-assessment.ts`, "ET") grades every
  answer against the same three-verdict scale (`well`/`adequate`/`struggled`)
  regardless of rung, then steps the ladder by `stepSize` (admin-configurable,
  default 1).
- **One shared final-assessment prompt** (`lib/cefr-prompt.ts`,
  `CEFR_SYSTEM_PROMPT`) scores every transcript against the same dimension
  anchors and the same WPM→fluency table, from A0 to C2.
- **Turn-boundary detection** (`lib/turn-vad.ts`) uses a flat two-tier
  silence timeout (1200ms for short utterances, 2500ms otherwise) to decide
  a turn is over — it has no awareness of question difficulty. A candidate
  pausing to think through a genuinely hard C2 question gets the same
  patience budget as someone pausing after "what's your name?".
- **Starting rung is already admin-configurable per language**
  (`lib/conversation-settings-service.ts`, `conversation_settings` table) —
  but only from **turn 2 onward**. Turn 1 is hardcoded to `A1`
  (`app/page.tsx:896`, `isStart ? "A1" : currentRungRef.current`): every
  session today opens with the same A1 warm-up question no matter what the
  configured starting rung is. This is the main existing gap the URL-param
  feature (#2) needs to close — it's not just a new input, it's fixing a
  spot where the "configurable starting rung" concept already stops short.

## 3. Proposed design

Frame it as **three zones** layered on the existing single-prompt system,
not three separate apps:

| Zone | Rungs | Change from today |
|---|---|---|
| **Foundation** | A1, A2 | Softer question/follow-up behaviour + adjusted assessment expectations |
| **Core** | B1, B2, C1 | **Untouched** — this is the tuned, working path |
| **Mastery** | C2 (new rung) | Genuinely harder questions + pause-aware VAD/assessment |

### 3.1 Extend the ladder with a real C2 rung

- Add `C2` to `CEFR_LADDER` (`lib/cefr-rung.ts`). `stepRung`
  (`lib/level-assessment.ts`) already works on ladder indices, so this is
  mechanical for the stepping logic itself.
- Give C2 its own "beyond the bank" instruction block, the same shape as
  today's C1 example set but a genuine notch up: register-shifting,
  meta-linguistic, philosophical-argument, precision-under-pressure
  questions — not just harder topics, but questions that demand the kind of
  answer where a B2/C1 speaker would visibly struggle to find words.
- A C1 candidate who does consistently "well" should now step up into C2
  territory instead of being capped at C1 forever — this is a deliberate,
  desired behaviour change at the extreme top, while B1–C1 traffic (the
  common case) is unaffected since it never reaches the new rung.

### 3.2 Zone-specific conversation behaviour (deltas, not a rewrite)

`buildCommonRules` in `lib/conversation-prompts.ts` stays the shared base.
Add small, explicitly-scoped overrides keyed on zone:

- **Foundation (A1/A2):** soften the "press once, be direct, do not soften"
  short-answer rule — a true beginner's short answer is often the ceiling of
  what they can produce, not evasion. Cap how abstract an improvised
  follow-up is allowed to get (today's "aim for half your own questions" is
  unconstrained in difficulty). Keep everything else (pivots, bridges, topic
  breadth, closing) as-is.
- **Mastery (C2):** explicitly permit longer pre-answer silence in the
  prompt framing sent downstream (see 3.4), and lean the "aim for half your
  own questions" instruction toward argument/precision rather than topic
  breadth, since C2 discrimination is more about handling nuance under one
  topic than sampling many.
- **Core (B1–C1):** no changes.

### 3.3 Zone-specific assessment calibration

Two assessment surfaces to touch, both currently one-size-fits-all:

- **ET (`lib/level-assessment.ts`, per-turn pacing judge):** at Foundation,
  weight comprehension and basic accuracy over elaboration when picking
  `well`/`adequate`/`struggled` — an A1 speaker giving a correct one-word
  answer isn't "struggling". At Mastery, treat a longer pause followed by a
  developed, precise answer as `well`, not `adequate` — today's prompt has
  no concept of "took time to think it through", only speed/directness
  signals.
- **Final CEFR read (`lib/cefr-prompt.ts`):** the dimension anchors and the
  WPM→fluency table are written with a "competent B1+ learner, benefit of
  the doubt" bias throughout (see e.g. the `VOCABULARY_GRAMMAR PROTECTION
  RULE` and the generous upper-band anchors). Add explicit calibration notes
  for the two extremes: don't penalize A1/A2 transcripts for lacking range
  they were never asked to demonstrate; don't let pause-inclusive WPM
  (already flagged as a known limitation — see the WPM mapping note in
  `lib/cefr-prompt.ts`) drag a C2 candidate's fluency score down when the
  transcript shows precise, complex language once they do speak.

This is additive text in the existing prompts (rung-conditional sections),
not a fork into separate prompt files — keeps the two assessment surfaces
in one place each, matching how `buildCommonRules` already branches on
`avoidDomain`/`openerDomain`.

### 3.4 Make the VAD pause-aware at the top of the ladder

This is the concrete fix for "harder C2 questions → more blanks → read as
errors": `lib/turn-vad.ts`'s `SILENCE_MS_LONG` (2500ms) is a flat constant
with no notion of difficulty. Plan:

- Thread the current rung into `TurnVad` (it already receives callbacks from
  `app/page.tsx`, which already tracks `currentRungRef`) via a small
  `setDifficultyRung()`/similar method, mirroring the existing
  `setAvatarSpeaking()` pattern.
- At C2 (and possibly B2/C1 to a lesser degree), extend the long-silence
  window before a turn is considered finished, so a genuine thinking pause
  before a hard answer isn't cut off or counted as near-silence.
- At Foundation, leave VAD timing as-is (or even tighten slightly) since
  short answers are expected and normal.

This needs real tuning against live recordings (per the file's own header
comment, today's thresholds were carried over from an unrelated retired
experiment and never re-tuned) — flagged as a validation step, not a
one-shot constant change.

**Implemented:** `TurnVad.setExtendedPauseTolerance(enabled)` (kept
CEFR-agnostic on purpose — it takes a bool, not a rung, so `lib/turn-vad.ts`
doesn't need to know what C2 is); `app/page.tsx` calls it wherever
`currentRungRef`/`conversationSettingsRef` changes (ET result, settings
fetch, session reset, VAD creation) with `rung === "C2"`. When enabled, the
long-silence budget becomes `SILENCE_MS_LONG_EXTENDED = 4000` (vs. 2500
default) — a starting guess, not yet validated against real recordings (see
§8). B1/B2/C1 timing is untouched.

## 4. Direct starting-level mode (URL parameter)

- Add a `?level=` query param using raw CEFR codes (`?level=A1` …
  `?level=C2`), read client-side in `app/page.tsx` and validated against
  `isCefrRung` (once extended to include C2) — no alias/zone-name layer.
- **Precedence:** URL param > per-language admin default
  (`conversation_settings` table) > hardcoded fallback (`A2`/step 1). This
  slots in next to the existing fetch in `startSession()`
  (`app/page.tsx:562-576`) rather than replacing it.
- **Must also override turn 1**, not just `currentRungRef` for turn 2+ — today
  turn 1 is hardcoded to the A1 warm-up (`app/page.tsx:896`) independent of
  any starting-rung configuration. A candidate routed to the C2 zone by URL
  should not still sit through an A1 "what's your name" opener; the opening
  line's target rung and its warm-up-question framing need to follow the
  param too. Concretely: the `isStart ? "A1" : ...` branch becomes
  `isStart ? conversationSettingsRef.current.startingRung : ...`, and the
  per-language opening-line instructions in `getSystemPrompt` need a
  rung-aware variant of the warm-up ask (an A1-level "where are you from"
  makes no sense as the opener for a candidate routed to Mastery).
- **Session-start override only** — ET is still free to move the rung up or
  down turn-by-turn from wherever the session opened, exactly like today.
  The param picks a starting point, not a locked zone; this keeps the change
  additive rather than altering the live-adaptive mechanism itself.
- No param present → behaviour is byte-for-byte what it is today (admin
  default, A1-hardcoded turn 1, unaffected).

**Implemented** exactly as scoped above: `getLevelOverrideFromUrl()` in
`app/page.tsx` reads `?level=`; `startSession()` applies it synchronously to
`conversationSettingsRef.current.startingRung` before the admin-settings
fetch resolves, and the fetch's `.then` no longer lets a resolved admin
default clobber it (stepSize still comes from the fetch either way). Turn
1's rung is now `conversationSettingsRef.current.startingRung` instead of
hardcoded `"A1"`. The per-language opening-line instructions in
`getSystemPrompt` were split into `OPENING_QUESTION_LINE[lang](rung)` —
byte-for-byte identical wording when `rung === "A1"`, a rung-aware sentence
otherwise.

## 5. Explicit non-goals

- No change to B1/B2/C1 prompts, question banks, ET scale, VAD timing, or
  final-assessment anchors for that range.
- No change to default (no-URL-param) session behaviour.
- Not building a full "test mode" or admin UI for this in v1 — just the
  mechanism (ladder + prompts + VAD + URL param). Admin surfacing of the new
  C2 rung in the existing settings page (`app/admin/(dashboard)/settings`)
  is a natural follow-up, not required for the core feature.

## 6. Rollout / validation approach

1. ✅ Extend the ladder + add C2 question material (3.1) — lowest-risk, purely
   additive. **Still to do:** verify B1–C1 sessions are unaffected via the
   existing eval-lab replay tooling (`FullEvaluationPanel`, per
   `doc/assessment_process.md`'s "Checking whether a past session would
   score the same today" section) — not yet run.
2. ✅ Layer zone-conditional prompt deltas (3.2, 3.3) behind the rung value
   already flowing through `getSystemPrompt`/`buildCommonRules`/
   `lib/level-assessment.ts`/`lib/cefr-prompt.ts`. **Still to do:** same
   replay check as (1); `CEFR_PROMPT_VERSION` was bumped to `v2` so replay
   results are distinguishable from pre-change scoring.
3. ✅ VAD pause-awareness (3.4) — code in place
   (`setExtendedPauseTolerance`). **Still to do:** needs live test sessions
   at C2, not just replay (VAD is a live timing behaviour the transcript
   replay tooling doesn't exercise). Record a handful of real C2-target
   sessions before/after and listen for premature cutoffs; tune
   `SILENCE_MS_LONG_EXTENDED` (currently 4000ms, a guess) from what's heard.
4. ✅ URL param + turn-1 override (4).
5. **Not yet done:** run real test sessions at each extreme (true beginner,
   near-native speaker), comparing ET verdict distribution and final CEFR
   output the same way `doc/assessment_process.md`'s known-limitations
   section already tracks drift.

## 7. Decisions (2026-09-10)

- **URL param:** raw CEFR code, `?level=A1` … `?level=C2` — no zone-name
  alias layer.
- **C2 stepping:** fully steppable both ways, same as every other rung — ET
  can move a candidate back down to C1 if a later answer is weaker. No
  one-way "ceiling broken" flag.
- **Foundation (A1/A2) assessment:** small calibration deltas added to the
  existing shared ET/CEFR prompts, conditional on rung — not a separate
  dedicated prompt. Revisit only if this proves insufficient once real A1/A2
  sessions are tested.
- **Sequencing:** follow the plan's order — (1) ladder + C2 content, (2)
  zone prompt deltas, (3) VAD pause-awareness, (4) URL param last. Each step
  is checked against B1–C1 replay before moving to the next.

## 8. Still open

- Concrete new `SILENCE_MS_LONG`-equivalent value for the Mastery zone —
  shipped as `SILENCE_MS_LONG_EXTENDED = 4000` in `lib/turn-vad.ts`, a
  starting guess, not yet validated against real recordings.
- No live test sessions run yet at any of the new zones (A1/A2 "softer"
  behaviour, C2 harder questions + pause tolerance, `?level=` routing) — code
  compiles and builds (`npx tsc --noEmit`, `npm run build` both clean) but
  hasn't been exercised against a real microphone/conversation.
- No replay check yet confirming B1–C1 sessions score identically to before
  (§6, steps 1–2) — the changes are additive/rung-conditional by
  construction, but this hasn't been verified against stored sessions.
- `conversation_settings` table's DB check constraint still only allows
  `starting_rung in ('A1','A2','B1','B2','C1')` — admins cannot set C2 as a
  per-language default starting rung yet (the `?level=C2` URL override
  doesn't go through this table, so it's unaffected, but the admin
  settings UI/API would need a migration + `ConversationSettingsRow.tsx`
  update to expose C2 as a settable default). Left as-is deliberately, per
  §5's non-goals.

## 9. Onboarding redesign — precedence addendum (2026-09-16)

The pre-session welcome screen (`app/page.tsx`) adds a fourth tier to the
starting-rung precedence chain, between the URL override (§7) and the
per-language admin default (§1-6): a signed-in returning user's remembered
rung, stored on `profiles.last_rung` (`supabase/migrations/0009_profile_preferences.sql`)
and written after every session they complete
(`upsertProfilePreference` in `lib/sessions-service.ts`).

Full precedence, highest wins: **`?level=` URL param > `profiles.last_rung`
(signed-in user) > `conversation_settings` per-language admin default >
hardcoded fallback.** `stepSize` is unaffected by this addendum — it always
comes from the admin-default fetch, exactly as before.

`profiles.last_rung` allows all 6 CEFR rungs (including C2), unlike
`conversation_settings.starting_rung` (§8, still A1-C1 only) — it stores a
user's actually-attained level, not an admin-set starting point, so the two
columns' constraints are intentionally different.
