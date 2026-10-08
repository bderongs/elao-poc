# Analysis — measure a change before shipping it

Offline tools that answer **"what would this change do to the sessions we already have?"**
Nothing here calls an LLM or writes to the database; it only reads stored sessions.
Reports are written to `analysis/reports/` (git-ignored).

| Tool | Question it answers | Run |
|---|---|---|
| **`scoring-replay.ts`** | If we change the scoring formula, which stored sessions change level? | `npm run analysis:scoring -- --scenario <name>` |
| [`../scripts/forgiveness-replay.ts`](../scripts/forgiveness-replay.ts) | What does the recognition-error forgiveness do to pronunciation averages? | `npx tsx scripts/forgiveness-replay.ts` |
| [`../scripts/asr-disagreement.ts`](../scripts/asr-disagreement.ts) | Where do two speech recognisers disagree on stored audio? | `npx tsx scripts/asr-disagreement.ts --limit 20` |
| [`../scripts/stt-replay.ts`](../scripts/stt-replay.ts) | How does one STT provider handle a stored turn? | `npx tsx scripts/stt-replay.ts <wav-url>` |
| [`../scripts/sim-batch.ts`](../scripts/sim-batch.ts) | How do simulated learners fare with the examiner? | `npm run sim:batch -- --level A1 --lang fr --runs 10` |

(The `scripts/` tools predate this folder and stay where they are; new analysis tools go here.)
Needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env`. The database is shared by dev and production, so you are reading real sessions.

---

## Scoring replay

### Quick start

```bash
npm run analysis:scoring -- --list                       # available scenarios
npm run analysis:scoring -- --scenario no-floor          # one change vs. today's rules
npm run analysis:scoring -- --scenario wpm-fluency,bonus-8.5   # stack changes
npm run analysis:scoring -- --scenario no-floor --evidence turns --lang fr --since 2026-09-17
```

Options: `--lang <code>`, `--since <YYYY-MM-DD>`, `--source conversation|simulation|upload|all` (default `conversation` = real live sessions), `--limit <n>` (default 500), `--evidence stored|turns` (see "The C2 floor and old sessions").

### Reading the report

```
Baseline check: the replay's production rules equal the live formula on 59/59 sessions.
42 of 59 sessions change level (1 up, 41 down).

| Session  | Lang | Date       | Words/answer | Answers | Before     | After        | Why                       |
| 0d381874 | en   | 2026-09-30 | 90           | 8       | C2 (92)    | ↓ C1+ (86)   | +5% bonus                 |
```

- **Baseline check** must say `N/N`. It proves the replay's copy of the formula still equals the live one (`computeCompositeCefrScore`). If it doesn't, `analysis/lib/rules.ts` has drifted from `lib/cefr-score.ts` — fix that first, nothing else in the report can be trusted.
- **Before** = the level users actually saw (the evaluator's score plus the +5 % bonus). The `cefr_level` column in the database is the evaluator's level *before* the bonus, so it can differ.
- **After** = the same session re-scored with your scenario. ↑/↓ = level moved, = unchanged. Changed sessions are listed first.
- **Why** lists the rules that moved the number.
- A ⚠ line appears when a session moves by more than two steps (e.g. B1 → C1): read those first, a good rule rarely does that.

### What to check before shipping a rule

1. **No regression where we are confident.** Mid-range sessions (A2–C1) should not move unless you intended it.
2. **It does what it was meant to do.** E.g. the C2 floor should lift the strong native sessions and nothing else.
3. **Weak sessions stay put.** A rule that rescues weak candidates is a bug.
4. **Mind the sample.** Most stored sessions are the team's own EN/FR tests. The replay is a *regression guard* (nothing broke), not a *calibration* (the thresholds are right). Calibration needs more real sessions, ideally including non-native controls.

### How the scoring works (and where it lives)

```
LLM evaluator ──► fluency / vocabulary-grammar / communication axes (0–10, half points)
Audio engine  ──► pronunciation (0–100 → /10)
                          │
   base = mean of the axes × 10 ── +5 % if ≥ 2 axes ≥ 9 ── C2 floor (90) if ≥ 3 axes ≥ 9, none < 8,
                                                              ≥ 5 answers, ≥ 20 words/answer
                          ▼
                       score ──► level (5-point bands)
```

The evaluator's own holistic `score_percent` is still stored but no longer the base (it was noisy: identical axes gave 78 or 82). Active since **2026-10-08**.

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

**Display is computed when read.** The level and score users and admins see are computed from the stored axes each time a page is shown. Changing `SCORING_RULES` therefore changes how *every* stored session is displayed (list, detail, score breakdown). The database columns `cefr_level` / `global_score` keep what was saved at the time (the evaluator's level, before the bonus).

### The C2 floor and old sessions

The floor needs the answer count and mean answer length. They are stamped on the evaluation when it is created (`answer_count`, `words_per_answer`), so **sessions evaluated before 2026-10-08 never get the floor**. To see what the floor would do on them, add `--evidence turns`: the figures are recomputed from the stored turns for every session and "Before" becomes hypothetical (the report says so).

### Built-in scenarios

Each is an override of today's rules.

| Name | What it tests | Origin |
|---|---|---|
| `llm-base` | Go back to the evaluator's `score_percent` as the base (the pre-2026-10-08 behaviour) | Track V |
| `no-floor` | Switch the C2 floor off | Track V |
| `floor-looser` | Floor with 2 axes ≥ 9 and 15 words/answer | Track V |
| `wpm-fluency` | Clamp the LLM's fluency axis into the band its speaking rate dictates | AB-07 |
| `bonus-8.5` | Bonus counts an axis from 8.5 instead of 9 | AE-03 |
| `bonus-3-axes` | Bonus needs 3 axes ≥ 9 | — |
| `no-bonus` | Switch the +5 % bonus off | — |

### Try your own change

**A. Tweak an existing rule's numbers** — edit its entry in `analysis/scenarios.ts` (e.g. `minWordsPerAnswer: 20` → `15`) and re-run.

**B. New scenario from existing knobs** — add an entry:

```ts
"strict-bonus": {
  description: "Bonus needs 3 axes ≥ 9 and is +3 %.",
  overrides: { bonus: { minAxes: 3, pct: 3 } },
},
```

The knobs are the fields of `ScoringRules` in `lib/cefr-score.ts`: `baseScore`, `fluencyFromWpm`, `bonus.{minAxes,axisThreshold,pct}`, `c2Floor.{…}`.

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
