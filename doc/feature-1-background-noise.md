# Feature 1 — Background noise robustness

## Problem
Candidates take the oral test in noisy places. A cough, a laugh or a voice in the room makes the system think the candidate is still speaking, so the avatar waits and the test stalls. Reported by Michel (ELAO) on 30 Oct 2026.

## Goal
The avatar reacts to the candidate's actual speech and ignores short or non-speech noises. Recording quality stays good enough for scoring (including pronunciation).

## Non-goals
- No guarantee of a perfect result in a very loud room (we warn instead).
- No server-side audio processing in v1.

## Proposed behaviour

### 1. Better capture settings (quick win)
Request the microphone with `noiseSuppression`, `echoCancellation` and `autoGainControl` enabled. Zero cost and helps on most devices.

### 2. Neural voice activity detection (VAD) for end-of-speech
Replace any volume-threshold detection with a speech-specific VAD (for example Silero VAD in the browser).
- Ignore sound bursts shorter than ~400 ms (cough, laugh, door).
- End-of-speech silence delay adapts to the level: longer for A0–A2 (candidates hesitate), shorter for C1+.
- If a transcription of a "speech" segment returns nothing intelligible, treat it as non-speech and resume waiting.
- The "j'ai fini de parler" button stays as a manual fallback.

### 3. Two audio paths (protects scoring quality)
- **Path A (detection/transcription):** stream passed through ML denoising (for example RNNoise via WASM), used for VAD and speech-to-text.
- **Path B (scoring/recording):** only lightly processed audio (browser constraints only), used for pronunciation scoring and stored recordings.
Reason: aggressive denoising can distort phonemes and lower pronunciation scores. Validate on a sample before choosing which path feeds which service.

### 4. Environment check before the test
A 3-second mic check measures the noise floor and shows a message such as "It's quite noisy here — move somewhere quieter for a more reliable result". Soft warning, not blocking.

### 5. Reviewer visibility
Store the measured noise level and the number of ignored non-speech events with the session so reviewers can interpret a surprising score.

## Acceptance criteria
- A cough or laugh of under 1 second during the candidate's turn does not delay the avatar by more than the normal end-of-speech delay.
- Sustained background speech at moderate volume no longer blocks the avatar indefinitely (there is a maximum wait, after which the avatar moves on or prompts the candidate).
- Pronunciation scores on a reference set of clean recordings change by no more than an agreed tolerance with the new pipeline.
- The pre-test check works on a low-end school laptop without noticeable lag.

## Risks / open questions
- CPU load of WASM denoising on low-end hardware: measure, and fall back to browser constraints only if too heavy.
- Safari/iOS handling of audio constraints differs: test.
- Which transcription and pronunciation services receive which audio path.

## Test plan
Record or collect samples with typical noises (cough, laughter, TV, street, open-plan office), replay them through the pipeline, and compare end-of-speech timing and scores before and after.
