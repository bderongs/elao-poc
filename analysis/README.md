# Analysis — measure a change before shipping it

Offline tools that answer **"what would this change do to the sessions we already have?"**
Nothing here calls an LLM or writes to the database; it only reads stored sessions.
Reports are written to `analysis/reports/` (git-ignored).

| Tool | Question it answers | Run |
|---|---|---|
| **`scoring-replay.ts`** | If we change the scoring formula, which stored sessions change level? | `npm run analysis:scoring -- --scenario <name>` |
| **`calibration.ts`** | How close is our oral evaluation to real candidates' reference levels? | `npm run analysis:calibration` |
| [`../scripts/forgiveness-replay.ts`](../scripts/forgiveness-replay.ts) | What does the recognition-error forgiveness do to pronunciation averages? | `npx tsx scripts/forgiveness-replay.ts` |
| [`../scripts/asr-disagreement.ts`](../scripts/asr-disagreement.ts) | Where do two speech recognisers disagree on stored audio? | `npx tsx scripts/asr-disagreement.ts --limit 20` |
| [`../scripts/stt-replay.ts`](../scripts/stt-replay.ts) | How does one STT provider handle a stored turn? | `npx tsx scripts/stt-replay.ts <wav-url>` |
| [`../scripts/sim-batch.ts`](../scripts/sim-batch.ts) | How do simulated learners fare with the examiner? | `npm run sim:batch -- --level A1 --lang fr --runs 10` |

(The `scripts/` tools predate this folder and stay where they are; new analysis tools go here.)
Needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env`. The database is shared by dev and production, so you are reading real sessions.

---

## Calibration

The scoring replay proves nothing broke; calibration asks whether the levels are *right*. The calibration set is 150 real candidates from the client's ELAO placement tests (Speechace speaking part: five short monologues, recordings included), with two reference levels each:

- **oral** — the Speechace speaking level ELAO derived (mostly acoustic: a fluent speaker with B1 grammar can get C2);
- **global** — ELAO's level across its other tests (grammar, vocabulary, listening).

Neither is ground truth and they often disagree, so read "within one level" before "same level".

```bash
npx tsx scripts/calibration-set.ts build     # once: store references, pick the set (25 per oral level A1–C1 + 25 C2), import missing ones
npx tsx scripts/calibration-set.ts score     # our pronunciation on the recordings, then the evaluator at the current prompt
npm run analysis:calibration                 # the report (agreement, level-by-level table, pronunciation vs Speechace, big misses)
```

- The exports (`doc/SpeechAce/`, one .xlsx per client) hold names and e-mails: they stay out of git. Only levels and scores are stored, on `sessions.speechace_scores.reference`; `reference.calibration = true` marks the set.
- **After a prompt change** (bump `CEFR_PROMPT_VERSION`), run `score` again — it only evaluates sessions with no evaluation at the new version — then `npm run analysis:calibration` and compare with the previous report (`--prompt v6` reads an older version).
- `score` and `build` write to the shared database and call paid APIs; the report only reads.
- Levels are computed with the production rules, so they stop at C1+ like the live test; a reference C2 scored C1+ counts as one level apart.
- **Formula changes** don't need re-evaluating: `npm run analysis:calibration -- --variants pron-stretch,linear-axes` compares rule sets (scenarios) on the same evaluations.
- **Pronunciation engines**: `npx tsx scripts/calibration-set.ts compare voxtral` runs another engine on every answer (comparison only — though an admin "recompute" on one of these sessions would then make the latest engine its headline), and the report adds an engine-by-engine comparison.

---

## Scoring replay

### Quick start

```bash
npm run analysis:scoring -- --list                       # available scenarios
npm run analysis:scoring -- --scenario no-c2-gate        # one change vs. today's rules
npm run analysis:scoring -- --scenario linear-axes,with-bonus   # stack changes
npm run analysis:scoring -- --scenario with-floor --evidence turns --lang fr --since 2026-09-17
```

Options: `--lang <code>`, `--since <YYYY-MM-DD>`, `--source conversation|simulation|upload|all` (default `conversation` = real live sessions), `--limit <n>` (default 500), `--evidence stored|turns` (see "The C2 gate and old sessions").

### Reading the report

```
Baseline check: the replay's production rules equal the live formula on 59/59 sessions.
42 of 59 sessions change level (1 up, 41 down).

| Session  | Lang | Date       | Words/answer | Answers | Before     | After        | Why                       |
| 0d381874 | en   | 2026-09-30 | 90           | 8       | C2 (92)    | ↓ C1+ (86)   | +5% bonus                 |
```

- **Baseline check** must say `N/N`. It proves the replay's copy of the formula still equals the live one (`computeCompositeCefrScore`). If it doesn't, `analysis/lib/rules.ts` has drifted from `lib/cefr-score.ts` — fix that first, nothing else in the report can be trusted.
- **Before** = the level today's rules give (what users see now — the display is computed on read). The `cefr_level` column in the database is the evaluator's own level at the time, so it can differ.
- **After** = the same session re-scored with your scenario. ↑/↓ = level moved, = unchanged. Changed sessions are listed first.
- **Why** lists the rules that moved the number.
- A ⚠ line appears when a session moves by more than two steps (e.g. B1 → C1): read those first, a good rule rarely does that.

### What to check before shipping a rule

1. **No regression where we are confident.** Mid-range sessions (A2–C1) should not move unless you intended it.
2. **It does what it was meant to do.** E.g. a curve change should move the levels it targets, and nothing else.
3. **Weak sessions stay put.** A rule that rescues weak candidates is a bug.
4. **Mind the sample.** Most stored sessions are the team's own EN/FR tests. The replay is a *regression guard* (nothing broke), not a *calibration* (the thresholds are right). Calibration needs more real sessions, ideally including non-native controls.

### How the scoring works (and where it lives)

```
LLM evaluator ──► fluency / vocabulary-grammar / communication axes (0–10, half points)
                  (fluency capped at the top of the band its speaking rate allows, when the rate is reliable)
                  + speaker_errors (every genuine vocabulary/grammar error, jokers included)
Audio engine  ──► pronunciation (0–100 → /10)
Ladder (ET)   ──► c2_answers_well (answers to C2-bank questions judged "well")
                          │
   mean of the axes ── curve: ≤ 8 → × 10, 8 → 80, 9 → 87, 9.5 → 90, 10 → 100
                          │
   ceiling: the score stops at 89 (C1+); "top of scale" when c2_answers_well ≥ 2 and axis mean ≥ 8.75
                          ▼
                       score ──► level (5-point bands)
```

The evaluator's own holistic `score_percent` is still stored but no longer the base (it was noisy: identical axes gave 78 or 82). Axis-mean base since **2026-10-08**; curve, C2 gate and fluency cap since **2026-10-14** (a C1 speaker was rated C2: the evaluator scores C1 at 8–9 per axis, and the old × 10 plus the +5 % bonus and C2 floor turned that into C2). `--scenario before-2026-10-14` replays the old rules. Since **2026-10-18** the test doesn't report C2 at all (`ceiling`): C1 and C2 couldn't be told apart reliably (calibration set, live tests with a C1 and a native speaker); `--scenario show-c2` replays the 14–18 October rules that did.

| Piece | File |
|---|---|
| The rules, as data (`SCORING_RULES`) and the engine (`scoreWithRules`) | [`lib/cefr-score.ts`](../lib/cefr-score.ts) |
| Live entry point (what users see) | [`lib/cefr-score.ts`](../lib/cefr-score.ts) — `computeCompositeCefrScore`, `scoreToLevel` |
| What-if scenarios (overrides of `SCORING_RULES`) | [`analysis/scenarios.ts`](scenarios.ts) |
| Replay data loading | [`analysis/lib/sessions.ts`](lib/sessions.ts) |
| WPM → fluency table | [`lib/cefr-prompt.ts`](../lib/cefr-prompt.ts) — `FLUENCY_WPM_BANDS` |
| Answer evidence stamped on each evaluation | [`lib/cefr-prompt.ts`](../lib/cefr-prompt.ts) — `withAnswerEvidence` |
| Explanation shown to admins | `/admin/scoring` |

The replay runs the **same engine** as the app (`PRODUCTION_RULES` *is* `SCORING_RULES`), so it cannot drift; the baseline check is a safety net.

**Display is computed when read.** The level and score users and admins see are computed from the stored axes each time a page is shown. Changing `SCORING_RULES` therefore changes how *every* stored session is displayed (list, detail, score breakdown). The database columns `cefr_level` / `global_score` keep what was saved at the time (the evaluator's own level).

### The WPM → fluency rule (AB-07)

The fluency axis is capped at the top of the band the speaking rate allows (`FLUENCY_WPM_BANDS`, e.g. 115–129 wpm → at most 8.5), instead of trusting the LLM to follow its own table. Since 2026-10-14 the rate only caps: a fast speaker no longer gets 10 for speed alone (`--scenario wpm-band` replays the old raise-and-cap rule). A speaking rate measured on little speech is noise (one 7-word answer came out at 341 wpm), so the rule only applies when there are **≥ 3 answers, ≥ 100 words in total and a rate ≤ 220 wpm** (`WPM_RELIABLE` in `lib/cefr-score.ts`). It needs the answer evidence, so it applies to sessions evaluated since 2026-10-08; for new evaluations the enforced value is also what is stored, so the fluency bar matches the score. Backtest it on old sessions with `--scenario no-wpm-fluency --evidence turns`.

### The ceiling, "top of scale" and old sessions

The "top of scale" note needs `c2_answers_well`, stamped on the evaluation when it is created (counted from the ladder, whose steps record each answer's bank-question rung since 2026-10-14). **Sessions evaluated before 2026-10-14 never get it** — they still stop at C1+. `speaker_errors` (prompt v6+) is stored and shown in the admin but no longer decides anything.

`--evidence turns` recomputes the answer count and length from the stored turns (they feed the speaking-rate cap and the old C2 floor, `--scenario with-floor`); "Before" then becomes hypothetical (the report says so).

### Built-in scenarios

Each is an override of today's rules.

| Name | What it tests | Origin |
|---|---|---|
| `before-2026-10-14` | The previous rules: × 10, +5 % bonus, C2 floor, WPM raises fluency, no C2 gate | — |
| `llm-base` | Go back to the evaluator's `score_percent` as the base (the pre-2026-10-08 behaviour) | Track V |
| `linear-axes` | Axis mean × 10 instead of the curve | — |
| `with-bonus` | Bring back the +5 % bonus (2 axes ≥ 9) | — |
| `with-floor` | Bring back the C2 floor | Track V |
| `show-c2` | Report C2 again: no ceiling, C2 by evidence (the 14–18 October rules) | — |
| `wpm-band` | The speaking rate also raises fluency into its band | AB-07 |
| `no-wpm-fluency` | Ignore the speaking rate entirely | AB-07 |
| `pron-stretch` / `pron-linear` / `pron-soft` | Stretch the pronunciation engine's squeezed 65–85 range over the axis (`pronunciationCurve`) | calibration |

### Try your own change

**A. Tweak an existing rule's numbers** — edit its entry in `analysis/scenarios.ts` (e.g. a curve point, or `maxSpeakerErrors`) and re-run.

**B. New scenario from existing knobs** — add an entry:

```ts
"strict-bonus": {
  description: "A +3 % bonus when 3 axes reach 9.",
  overrides: { bonus: { minAxes: 3, axisThreshold: 9, pct: 3 } },
},
```

The knobs are the fields of `ScoringRules` in `lib/cefr-score.ts`: `baseScore`, `axisCurve`, `pronunciationCurve`, `fluencyFromWpm`, `bonus`, `c2Floor`, `c2Gate`, `boundaryCheck`, `ceiling`. An override replaces the field whole.

**C. A genuinely new kind of rule** — add a field to `ScoringRules` (default = off in `PRODUCTION_RULES`), implement it in `scoreWithRules` (`lib/cefr-score.ts`), then add a scenario that turns it on. Keep "off" equal to the current behaviour.

### Shipping a change

1. Replay it; read the changed sessions and the ⚠ ones.
2. Make it the default: change `SCORING_RULES` in `lib/cefr-score.ts` (or the evaluator prompt in `lib/cefr-prompt.ts` — bump `CEFR_PROMPT_VERSION` if the prompt changes). Delete the scenario that was just shipped; add one that reverts it if you want to keep comparing.
3. Update `/admin/scoring` (`app/admin/(dashboard)/scoring/page.tsx`) so the explanation matches.
4. Remember the display is computed on read: every stored session shows the new score at once. Run the replay with the *reverting* scenario to see exactly what changed for them.

### Limits

- **Formula changes only.** The replay re-computes from stored numbers. A change to the evaluator *prompt* or to pronunciation scoring cannot be replayed here; for those, re-run sessions in the admin eval lab (per session) or use `scripts/forgiveness-replay.ts` (pronunciation forgiveness).
- Only sessions with a stored evaluation count (completed live conversations; unfinished ones have none).
- Simulated sessions (`--source simulation`) are model-generated learners, not people: useful to see a rule's mechanics, not for calibration.
