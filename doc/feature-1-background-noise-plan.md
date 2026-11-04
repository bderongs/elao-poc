# Feature 1 — Background noise: implementation plan

Scope: spec items **§2 (neural VAD)** and **§4 (pre-test noise check)** from [`feature-1-background-noise.md`](feature-1-background-noise.md). Also built: a maximum turn length (90 s, 120 s on Mastery questions — `MAX_TURN_MS` in `lib/turn-vad.ts`, logged as `turn_capped`), because background voices are speech to Silero and could otherwise hold a turn open until "J'ai terminé". Out of scope for now: RNNoise / two audio paths (§3), reviewer fields on the session (§5), and turning on browser noiseSuppression/AGC (§1). The assessment stream keeps them off on purpose (see `ensureMicStream` in `app/page.tsx`).

Because nothing here changes the audio that is recorded and scored, pronunciation scores are unaffected by construction. The acceptance criterion about a reference set therefore does not apply to this plan.

## What exists today

`lib/turn-vad.ts` (`TurnVad`) decides turn boundaries from **RMS against a learned noise floor**, on one `ScriptProcessorNode` (4096-sample buffers, ~85 ms at 48 kHz) tapping the assessment mic stream. Already in place, and to be kept as is:

- `MIN_SPEECH_MS` (400 ms), merging of short bursts (`BURST_MERGE_MS`)
- silence budgets per zone (Foundation without the short budget, Mastery 4 s)
- echo guard while the avatar speaks, barge-in, a 4-frame pre-roll for streaming STT, the stalled-frame watchdog
- an empty transcription releases the turn (`abandonTurn` in `app/page.tsx`)

**What goes wrong:** anything loud counts as voice. A cough after the answer resets the silence timer, so the avatar waits another 2.5–4 s. Continuous noise (fan, street, music) keeps the turn open. A door or cough while waiting opens a phantom turn.

## Part A — Silero VAD as the speech gate

**Status: built, live by default since 2026-11-03** (`lib/silero-vad.ts`, `lib/turn-vad.ts` `setClassifier`, `LIVE_TURN_VAD_MODE = "silero"`). `?vad=volume` goes back to the RMS-only rule for one session. Logs: `vad_mode`, `vad_ready`, `vad_load_failed`, `vad_degraded`, `vad_summary`, `turn_capped`. Differences from the plan below:
- `RMS_GATE_FACTOR` is **1.0**, not 0.5, and the noise floor is learned as in RMS mode (from every frame while the avatar is silent). So a frame is voiced in Silero mode only if RMS mode would also count it: Silero only removes false starts. At 0.5, with speech-like frames kept out of the floor, a TV or a colleague's voice was never learned as background and could hold a turn open. The quiet-mic case (Y-04) is covered by the learned floor and `MIN_SPEECH_THRESHOLD`.
- `TurnDetector` was not extracted yet: the classifier is a queue inside `TurnVad`. The extraction is still needed for the offline replay harness (Part C, not built).
- ORT's `wasmPaths` must point at the `.wasm` **file**. Given a folder, ORT also fetches its JS glue from there instead of using the bundled copy.
- Checked so far: in Node, synthesised speech scores ≈ 1.0, while noise bursts, clicks and fan noise score ≈ 0; the inference is ~0.6 ms per window on an M-series Mac. In headless Chrome, the model loads and runs from `/vad/`. Not yet checked on Safari, iOS or a low-end laptop.

### A.1 Design choices

- **Run Silero ourselves with `onnxruntime-web`, not `@ricky0123/vad-web`'s `MicVAD`.** `MicVAD` brings its own audio graph and its own start/end segmentation. Both would conflict with `TurnVad`'s timers, zones and barge-in. We only need **one speech probability per frame**, which takes about 80 lines around the model.
- **Model: Silero VAD v5 ONNX** (MIT, ~2.3 MB). It takes 16 kHz audio in 512-sample windows plus 64 samples of context, with an `[2,1,128]` state tensor carried between windows. Follow the official wrapper exactly.
- **WASM backend, single thread** (`ort.env.wasm.numThreads = 1`). Multithreading needs cross-origin isolation (COOP/COEP headers), which we don't want to impose on the whole app.
- **Self-host the assets** in `public/vad/` (model and ORT `.wasm`). Some school networks block CDNs. The `.wasm` is copied from `node_modules` by a `prebuild`/`predev` script so it always matches the JS package version. The model file is committed.
- **Probability as an extra condition, not a replacement.** Silero reports *any* human voice as speech, including the avatar's own voice leaking back into the mic and a TV across the room. The RMS logic stays as a second condition (see A.3).
- **RMS-only remains the fallback**, with exactly today's behaviour. It applies if the model fails to load, WASM is unavailable, or the device can't keep up.

### A.2 Code structure

1. **`lib/turn-detector.ts` (new, pure).** Contains everything `TurnVad.handleAudio` / `onSilenceTimeout` / `finalize` / `forceEnd` do today, moved out unchanged. It changes in two ways:
   - `processFrame(float32, { rms, speechProb | null, t })` replaces `handleAudio`.
   - Time goes through an injected `Clock` (`now`, `setTimeout`, `clearTimeout`) instead of `Date.now()`/`setTimeout`. The browser uses the real clock. Replay uses a fake clock that advances by frame duration, so the same code runs offline at full speed.
2. **`lib/silero-vad.ts` (new).** `SileroVad.load(): Promise<SileroVad>` (lazy `import("onnxruntime-web/wasm")`, model fetch, one warm-up run) and `probabilities(float32, sampleRate): Promise<number>`. The second method resamples to 16 kHz with a float linear resampler that keeps fractional phase across buffers, and carries leftover samples. It runs every complete 512 window and returns the **max** probability of the windows completed in that buffer (about 2.7 per 4096-sample buffer at 48 kHz, 2.9 at 44.1 kHz).
3. **`lib/turn-vad.ts` (thinned).** Keeps the audio graph, the watchdog, `resume`, `getSampleRate` and the public API used by `app/page.tsx`, which does not change. New in it:
   - `onaudioprocess` stamps the capture time and pushes the buffer onto a **serial queue**: inference, then `detector.processFrame`. Frames stay in order. Timing uses capture time, so inference delay doesn't skew `spokenMs`/WPM.
   - `setClassifier(silero | null)` switches mode at any time, so a session never waits for the model (see A.4).
   - **Lag guard:** if the queue holds more than 3 buffers (~250 ms behind), drop Silero for the rest of the session, flush the queue in RMS mode and log `vad_degraded`.

### A.3 Decision rule (starting values, tuned in Part C)

Silero mode, avatar silent: a frame is **voiced** when all three hold:

- `speechProb ≥ P_ON` (0.5), or `≥ P_OFF` (0.35) if the previous frame was voiced. This hysteresis follows Silero's own defaults.
- `rms > adaptiveThreshold × RMS_GATE_FACTOR` (started at 0.5, now 1.0 — see Status above). This keeps far, quiet voices (TV, colleagues) from counting while staying well under a quiet candidate's level (the Y-04 case in `client-feedback-plan.md`).
- Only voiced frames start a turn, reset the silence timer or count towards `MIN_SPEECH_MS`. Unvoiced frames inside a turn are still forwarded to streaming STT, as today.

Avatar speaking: voiced = `rms > ECHO_GUARD_THRESHOLD` **and** `speechProb ≥ P_ON`. A cough during the avatar's question no longer triggers a barge-in.

Noise floor: planned as learned only from frames with `speechProb < P_OFF`; built as in RMS mode instead (see Status above).

RMS mode: today's rule, unchanged.

The constants live at the top of `turn-detector.ts` with the same style of comments as the current ones.

### A.4 Loading and wiring (`app/page.tsx`)

- Start `SileroVad.load()` when the instructions/mic-check screen opens (next to the existing `ensureMicStream()` call), and keep the promise in a ref.
- `startSession` builds `TurnVad` exactly as today, in RMS mode. When the load promise resolves, it calls `vadRef.current.setClassifier(...)`. In practice the model is ready long before the first answer.
- A `TURN_VAD_MODE: "silero" | "rms"` constant (same pattern as `REALTIME_STT_ENABLED`), plus a `?vad=rms|silero` URL override for side-by-side live testing. Add a VAD row to `lib/system-config.ts` so the admin page shows what is live.
- Logs: `vad_ready` (mode, load ms, mean inference ms per window), `vad_degraded`, `vad_load_failed`. Per turn, add to the existing turn log event the number of frames that crossed the RMS threshold but were rejected by Silero ("ignored noise"). Feature item 5 can be built later from this data.

### A.5 Risks to clear first (spike, day 1)

- Does `onnxruntime-web` bundle cleanly with Next 15 / webpack (`.mjs`, `import.meta.url`)? If not, load it as a plain script from `public/vad/`.
- Load and inference time on Chrome, Safari macOS, **iOS Safari** and a low-end Windows laptop. Target: under 5 ms per 512 window on the slowest device. Check that Vercel serves the `.wasm` compressed.
- Does `onnxruntime-web` run under Node for the replay harness? If not, add `onnxruntime-node` as a dev dependency with the same `.onnx` file.

## Part B — Noise check on the mic-check screen

**Status: implemented** (`lib/noise-check.ts`, `app/page.tsx`: `updateNoiseCheck`, mic card, `mic_check` log). It differs from the plan below in one way: the floor uses the **10th** percentile, not the 20th, so a candidate reading the instructions aloud doesn't raise it.

The screen already asks the candidate to say "bonjour" and shows a level meter (`startMicLevelLoop`). Measure the room from that same loop. No extra step, no extra 3 seconds.

1. **Fix the meter's precision.** It reads `getByteTimeDomainData` (8-bit: one step ≈ 0.008 RMS). That reads a quiet room as 0, and our VAD thresholds sit at 0.003–0.02. Switch to `getFloatTimeDomainData`. The meter's dB display stays the same.
2. **`lib/noise-check.ts` (new, pure):** `assessRoom(rmsSamples)` returns `{ floorDb, voiceDb | null, snrDb | null, verdict }`.
   - floor = **20th percentile** of the last ~5 s of 80 ms readings. It stays robust to the candidate's "bonjour".
   - voice = 95th percentile, counted only if it is ≥ 10 dB above the floor (meaning someone actually spoke).
   - verdict:
     - `noisy` if `floorDb > -45` or `snrDb < 15`
     - `quiet-voice` if voice was heard but `voiceDb < -40` (≈ the 0.01 RMS of the Y-04 candidate)
     - `ok` otherwise
     - `unknown` before 3 s of data

   These thresholds are starting values to calibrate with the logs below.
3. **UI:** one amber line under the meter in the "VOTRE MICRO" card. It is never blocking, and "Je suis prêt" stays enabled. It appears after 3 s and stays shown until the room has read `ok` for 3 s, so it doesn't flicker.
   - noisy: « Votre environnement semble un peu bruyant. Le test fonctionnera, mais vos résultats seront plus fiables dans un endroit plus calme. »
   - Later, once Silero is loaded on this screen: frames Silero calls speech that are well below the candidate's own voice level suggest **voices in the background** (« Nous entendons des voix autour de vous… »). Add this only after the spike, with real `mic_check` data to set the threshold.
   - quiet-voice: « On vous entend faiblement. Rapprochez-vous du micro ou parlez un peu plus fort. »
4. **Log `mic_check` on "Je suis prêt"** with floor, voice and SNR, the verdict, and whether a warning was shown. Two weeks of these give the real distribution for setting thresholds, and they can be compared later with sessions where "J'ai terminé" was used a lot.

## Part C — Test harness and corpus

Stored turn recordings are silence-trimmed WAVs (`blobToWav16kMono`), so they can't measure end-of-speech timing. Two sources:

1. **Recorded corpus (about 20 clips, 30–60 s each), with ground truth.** Raw mic, AGC/NS off, at 48 kHz, on a laptop mic. Each clip is an answer with a known true end, followed by one of: a cough, a laugh, a door, a keyboard, a fan or street noise, a TV with voices, a colleague talking, or nothing. Include hesitant A1-style answers with 1.5–2 s pauses and one quiet-voice clip. Store the clips in `analysis/vad-corpus/`, with a `labels.json` holding `speechStart`/`speechEnd` per clip.
2. **Real candidate turns from Supabase.** Replay stored turn WAVs, padded with 3 s of silence, to check that Silero mode still detects real accented, quiet, hesitant speech. That means no missed answers and no new mid-answer cuts compared with RMS mode.

`scripts/vad-replay.ts` (`npm run analysis:vad`) runs every clip through `TurnDetector` in both modes with the fake clock and prints a table per clip:

- **end latency:** detected end minus true end
- **phantom turns:** turns opened with no speech
- **premature cuts:** a turn ended before the true end
- **ignored-noise frames**

### Pass criteria

- Coughs, laughs, doors and keyboard after an answer add **≤ 300 ms** to the end latency. Today they add a full silence budget.
- No phantom turns from non-speech noise.
- **Zero new premature cuts** on the hesitant and quiet-voice clips and on the real turns, compared with RMS mode.
- TV and colleague clips are reported, not required to pass. Background voices are a known limit of this approach.

## Order of work and estimate

| # | Step | Days |
|---|------|------|
| 1 | Spike: ORT + Silero in Next, assets, timings on 4 browsers, ORT under Node (A.5) | 1 |
| 2 | Extract `TurnDetector` with an injected clock, no change in behaviour; replay harness running in RMS mode | 1 |
| 3 | Record and label the corpus; pull a sample of real turns | 1 |
| 4 | `SileroVad` + queue + lag guard + decision rule + wiring/flag/logs; tune constants on the replay | 1.5 |
| 5 | Noise check: float meter, `assessRoom`, UI line, `mic_check` log | 1 |
| 6 | Live check on devices (Chrome Win low-end, Safari macOS, iOS, Android): one quiet, one noisy and one A1-hesitant session each | 1 |

**About 6.5 days.** Step 5 is independent and can ship first. Step 2 has to land before step 4, so that the RMS baseline is measured with the same harness.

## Rollout

1. Ship with `TURN_VAD_MODE = "rms"` and the noise check live (the warning plus logs).
2. Run the live checks with `?vad=silero`, then flip the default to `silero`. `?vad=rms` stays available as a rollback.
3. After two weeks, review the `mic_check` and `vad_*` logs: recalibrate the noise-check thresholds, and look at sessions with many "J'ai terminé" presses.

## Open questions

- Should the noise-check result also go on the session record now (one column), or wait for item 5?
- Background voices (TV, colleagues) stay a limit after this work. Should the client be told that explicitly in the spec's non-goals?
