# Handoff: ELAO — épreuve orale avec avatar (direction "Salle claire")

## Overview
Desktop flow for ELAO's spoken language assessment: the test-taker picks an assessment
language, reads a short explanation while checking their microphone, has a ~3-minute
spoken conversation with an avatar examiner ("Léa"), and lands on an analysis screen while
the CEFR level is computed. Interface copy is **French**. Audience: university students and
job candidates. Guiding principle: **reduce test anxiety** — one task per screen, nothing to
read while speaking, no live transcript, no score visible during the test.

## About the Design Files
The files in this bundle are **design references created in HTML** — a prototype showing
intended look and behaviour, not production code to copy. The task is to **recreate these
designs in the target codebase's existing environment** (React/Vue/etc.) using its
established patterns, component library and styling approach. If no environment exists yet,
pick the most appropriate framework and implement there. `support.js` is only the runtime
that makes the reference file open in a browser — it is not part of the delivery.

## Fidelity
**High-fidelity.** Colours, typography, spacing and states below are final values and should
be matched. Layout is fixed-width desktop (1280×760 frames); see Responsive behaviour.

---

## Screens / Views

All screens share a top bar: 22px vertical / 36px horizontal padding, ELAO logo at left
(three yellow bars 4px wide, heights 10/17/23px, 3px gaps, 1px radius, aligned to baseline +
9px gap + wordmark "ELAO", Outfit 500, 21px, letter-spacing 0.02em, colour `#141D33`).
Page background `#F7F5F0` on every screen.

### 1. Choix de la langue
**Purpose:** pick the assessment language and start.
**Layout:** top bar (right side: text "Mes sessions", 14px, `#6B6F7D`). Content column
centred vertically and horizontally, `gap: 40px`, padding `0 80px 60px`.
**Components**
- Heading, centred, max-width 620px: "Bonjour. Dans quelle langue / allons-nous parler ?"
  — Outfit 400, 42px, line-height 1.15, letter-spacing −0.02em, `#141D33`. Explicit line
  break before "allons-nous parler ?".
- Sub-copy: "Une conversation de trois minutes avec Léa, notre examinatrice. Il n'y a rien à
  préparer." — 17px, line-height 1.55, `#5A5F6E`.
- Language grid: `grid-template-columns: repeat(3, 236px); gap: 14px`. Six cards: Français,
  English, Nederlands, Español, Italiano, Deutsch.
  - Card: padding `20px 22px`, radius 12px, background `#FFFFFF`, border `1px solid #DDD9D0`,
    column layout, `gap: 5px`.
  - Label: Outfit 400, 19px, `#141D33`. Meta line: IBM Plex Mono 400, 11px, `#8A8F9C`,
    letter-spacing 0.1em — `FR · FRANCE`, `EN · UK`, `NL · BELGIQUE`, `ES · ESPAÑA`,
    `IT · ITALIA`, `DE · DEUTSCHLAND`.
  - Hover: `border-color: #141D33`.
  - Selected: border `2px solid #141D33` + shadow `0 2px 0 rgba(20,29,51,0.06)`.
    No flag emoji — the previous POC used them; they are out.
- Primary button: "Continuer en français" (label follows the selected language) — padding
  `16px 40px`, radius 10px, background `#141D33`, `#FFFFFF`, Outfit 500, 18px.
  Hover `#243052`.
- Helper under button: "Vous pourrez vérifier votre micro à l'étape suivante." — 13px,
  `#8A8F9C`.

### 2. Comment ça se passe (instructions + mic check)
**Purpose:** set expectations, verify the microphone.
**Layout:** top bar (right: "Français · évaluation orale", 14px, `#6B6F7D`). Body is
`display: grid; grid-template-columns: minmax(0,1fr) 420px; gap: 64px;
padding: 20px 80px 72px; align-items: center`.
**Left column** (`gap: 36px`)
- H2 "Votre niveau en 3 minutes" — Outfit 400, 38px, line-height 1.2, `#141D33`.
- Paragraph (max-width 460px, 17px, line-height 1.6, `#5A5F6E`): "Léa vous posera des
  questions simples sur votre quotidien. Répondez à voix haute, comme dans une vraie
  conversation."
- Three numbered steps, `gap: 20px`; badge 28px circle, background `#FDF0D0`, text `#8A6410`,
  Outfit 15px; title Outfit 18px `#141D33`, description 15px `#6B6F7D`:
  1. "Écoutez la question" / "Vous pouvez la faire répéter une fois."
  2. "Parlez librement" / "Hésiter, reprendre, se corriger : tout cela est normal."
  3. "Laissez un silence" / "Léa comprend que vous avez terminé et enchaîne."
- Button "Je suis prêt" (same primary style, padding `16px 36px`) + note
  "Aucune note n'est affichée pendant l'épreuve." (14px, `#8A8F9C`).
**Right column — mic card**
- Card: padding 28px, background `#FFFFFF`, border `1px solid #E4E0D7`, radius 14px,
  `gap: 18px`.
- Eyebrow "VOTRE MICRO" — IBM Plex Mono 11px, `#8A8F9C`, letter-spacing 0.12em.
- Live level meter: 12 bars, `flex: 1` each, `gap: 4px`, height 64px, `#141D33`, radius 2px.
  Bars animate (see Interactions); in production drive heights from real input level.
- Copy: "Dites « bonjour » pour vérifier que l'on vous entend bien." (15px, `#5A5F6E`).
- Device row, separated by `1px solid #EFEBE2` top border: 8px green dot `#2F9E6E` +
  "Micro détecté — MacBook Pro" (15px, `#141D33`). Device name comes from the real device.

### 3. En conversation — three turn states
**Purpose:** the conversation itself. Same frame in all three states; only the indicator
under the avatar changes. Nothing else moves — that stability is the point.
**Layout:** top bar with progress at right: 132px × 4px track `#E4E0D7`, radius 2px, fill
`#141D33` (width = elapsed %), plus `MM:SS restantes` in IBM Plex Mono 14px `#5A5F6E`.
Body centred column, `gap: 34px`, `padding-bottom: 44px`.
**Avatar stage:** 520 × 420px, `border-radius: 200px 200px 24px 24px`, border
`1px solid #E0DBD1`. In the reference it is a striped placeholder
(`repeating-linear-gradient(135deg,#EDE9E1 0 10px,#F4F1EA 10px 20px)`) with a mono caption —
**replace with the real avatar render**, cropped to the same rounded-arch shape. The
"avatar parle" state also has a bottom fade `linear-gradient(to top, rgba(247,245,240,0.95),
rgba(247,245,240,0))`, 96px tall, to seat the figure on the background.

*State A — Léa speaks:* pill, padding `11px 22px`, radius 100px, background `#141D33`;
inside, 5 bars 3px wide, 20px tall, `#F5B921`, gap 3px, animating; label "Léa vous parle"
(Outfit 17px `#FFFFFF`). Below pill: "Écoutez — vous répondrez juste après." (15px `#8A8F9C`).

*State B — the user's turn:* stage gets a breathing ring
`box-shadow: 0 0 0 8px rgba(245,185,33,0.35)` (see Interactions). Indicator pill: padding
`12px 26px`, radius 100px, background `#FDF0D0`, border `1px solid #F0DDA8`; 8 level bars
4px wide, 26px tall, `#8A6410`; label "À vous — on vous écoute" (Outfit 18px, `#4A3708`).
Under it two text actions, 15px `#6B6F7D` with a `1px solid #C9C4B8` underline offset 2px:
"Répéter la question", "Passer".

*State C — between questions:* pill padding `13px 24px`, background `#EDEAE2`, border
`1px solid #E0DBD1`; three 7px dots `#5A5F6E` pulsing; label "Léa prépare la question
suivante" (Outfit 17px, `#3A4055`). Below: "Deux questions sur trois terminées. Vous vous en
sortez bien." (15px `#8A8F9C`) — progress is phrased in words, never as a score.

### 4. Fin de l'épreuve / analyse
**Purpose:** confirm the test is over and that analysis is running.
**Layout:** top bar (logo only). Centred column, `gap: 34px`, `padding: 0 80px 60px`.
**Components**
- Five yellow bars (`#F5B921`), 7px wide, 56px tall, radius 3px, gap 5px, slow wave.
- H2 "C'est terminé, merci." — Outfit 400, 38px, `#141D33`.
- Paragraph (max-width 560px, 17px, line-height 1.6, `#5A5F6E`): "Nous analysons votre prise
  de parole : prononciation, fluidité, vocabulaire et grammaire. Votre niveau CECRL
  s'affichera dans un instant."
- Progress: 420px wide, 4px track `#E4E0D7`, fill `#141D33`; under it, split row in IBM Plex
  Mono 12px `#8A8F9C` letter-spacing 0.08em: "ANALYSE EN COURS" / "~20 S".
- Footnote: "Vous pouvez fermer cette fenêtre : le rapport vous sera envoyé par e-mail."
  (14px `#8A8F9C`).

---

## Interactions & Behavior
- **Flow:** language → instructions/mic check → conversation → analysis. Forward only; no
  back navigation once the conversation starts.
- **Turn cycle:** avatar speaks (state A) → user's turn (state B, mic open) → end of speech
  detected by silence → state C → next question. Conversation lasts SESSION_DURATION_MINUTES (lib/session-config.ts), then screen 4.
- **Waveform bars** (`@keyframes wave`): `scaleY(0.28)` → `scaleY(1)` → back,
  `transform-origin: bottom`, `ease-in-out`, infinite. Durations: 0.7s (user speaking, the
  fastest — it should feel responsive), 0.9s (avatar speaking), 1.0–1.1s (mic check), 1.5s
  (analysis screen). Per-bar delay 0.06–0.15s stagger. In production the user-turn bars must
  reflect real microphone amplitude, not a canned animation; keep the canned one for the
  avatar.
- **Breathing ring** (`@keyframes breathe`, user's turn): `scale(1)`/opacity 0.5 →
  `scale(1.06)`/opacity 0.9 → back, 2.6s ease-in-out infinite.
- **Thinking dots** (`@keyframes dot`): opacity 0.25 → 1 → 0.25, 1.4s ease-in-out infinite,
  delays 0 / 0.2 / 0.4s.
- **State transitions** should cross-fade the indicator pill (~200ms) — the avatar stage and
  everything around it must not shift position between states.
- **"Répéter la question"**: allowed once per question; disable (colour `#C9C4B8`, no
  underline) after use.
- **"Passer"**: advances to the next question; confirm inline if no speech was recorded.
- **Timer**: counts down from the total duration; display `MM:SS restantes`. It should never
  turn red or flash — no urgency pressure.
- **Hover states**: cards `border-color: #141D33`; primary button `#243052`; text actions
  darken to `#141D33`.
- **Error states** (not designed — needed in implementation): microphone permission denied,
  microphone lost mid-test, connection dropped. Follow the calm tone: explain, offer retry,
  never lose the session.

## State Management
- `selectedLanguage: 'fr' | 'en' | 'nl' | 'es' | 'it' | 'de'` (default `fr`).
- `phase: 'language' | 'instructions' | 'conversation' | 'analysis'`.
- `turnState: 'avatarSpeaking' | 'userSpeaking' | 'thinking'`.
- `questionIndex` (0-2), `questionCount` (3).
- `secondsRemaining` (total duration ~180s), derived progress fill %.
- `micStatus: 'pending' | 'granted' | 'denied'`, `micDeviceLabel`, `micLevel` (0-1, drives
  the level meter).
- `repeatUsedForCurrentQuestion: boolean`.
- Data: avatar audio/video stream + question script from the assessment backend; the recorded
  audio is uploaded for scoring at the end of each turn.
- Two design flags exist in the prototype and are worth keeping as configuration:
  `showTimer` (default true) and, in the alternative direction, a caption of the current
  question (default true in 1b, absent in this direction).

## Design Tokens
Colours
- Page background `#F7F5F0`; surface `#FFFFFF`; ink `#141D33`; ink hover `#243052`;
  body text `#5A5F6E`; muted `#6B6F7D`; faint `#8A8F9C`.
- Borders: `#DDD9D0` (cards), `#E4E0D7` (panels/tracks), `#E0DBD1` (stage), `#EFEBE2`
  (hairline), `#C9C4B8` (text-action underline).
- ELAO yellow `#F5B921`; yellow tint `#FDF0D0`; yellow tint border `#F0DDA8`; yellow ink
  `#8A6410` / `#4A3708`.
- Success dot `#2F9E6E`. Neutral pill `#EDEAE2`, its text `#3A4055`.
Typography
- Display/UI: **Outfit** 300/400/500 — 42/40/38px headings, 21px wordmark, 17–19px labels.
- Body: **DM Sans** 400/500 — 17px lead, 15px secondary, 14px/13px helpers.
- Mono (meta, eyebrows, timer): **IBM Plex Mono** 400 — 14/12/11px, letter-spacing
  0.08–0.12em, uppercase.
- Minimum text size on screen: 13px.
Spacing: 4 / 5 / 10 / 14 / 18 / 20 / 22 / 26 / 34 / 36 / 40 / 64 / 72 / 80 px.
Radius: 2 (tracks) / 10 (buttons) / 12 (cards) / 14 (panels) / 100 (pills) /
`200px 200px 24px 24px` (avatar stage).
Shadows: selected card `0 2px 0 rgba(20,29,51,0.06)`; frame shadow in the reference canvas
only (`0 20px 50px rgba(20,29,51,0.12)`) — not part of the app.

## Assets
- **ELAO logo**: drawn with three rectangles + the "ELAO" wordmark in the reference. Use the
  real brand SVG from the ELAO site (`logo-elao.svg` / `ELAO_RVB.svg`) in production.
- **Avatar**: the reference uses striped placeholders labelled "AVATAR 3D — LÉA". Real
  renders/stream come from the avatar provider; crop to the stage shape above.
- **Fonts**: Outfit, DM Sans, IBM Plex Mono — all Google Fonts. Swap to ELAO's licensed brand
  face if one exists.
- No icon set is used; the mic meter and indicators are built from plain rectangles.

## Responsive behavior
Designed for desktop at 1280×760. The layout is centred and tolerant of wider viewports
(content max-widths are fixed; background fills). Below ~1100px the instructions screen's two
columns should stack (mic card under the steps) and the avatar stage should scale down
proportionally, keeping its aspect ratio. Mobile was out of scope for this round.

## Files
- `ELAO Speaking 1a.dc.html` — the chosen direction, all four screens, in order. Frames carry
  `data-screen-label` attributes (`1a-langue`, `1a-instructions`, `1a-live-avatar-parle`,
  `1a-live-a-vous`, `1a-live-reflexion`, `1a-fin`) for cross-referencing.
- `support.js` — runtime needed only to open the reference file in a browser. Ignore it when
  implementing.
