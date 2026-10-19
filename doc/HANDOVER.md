# ELAO Speaking — Handover: accounts, services & GDPR

This document lists every external account the application depends on, what
each one is used for, how to take it over, and how each service stands with
regard to GDPR and EU data residency.

For how the application works (candidate flow, models, architecture, admin
accounts), see [`README.md`](../README.md). For every environment variable,
see [`.env.example`](../.env.example).

---

## 1. Summary

| Service | Status | Purpose | Data location |
|---|---|---|---|
| Vercel | **Required** | Hosting (web app + API routes) | US company — region to set to EU (see §4) |
| Supabase | **Required** | Database, user accounts, audio storage | Ireland (eu-west-1) |
| Mistral AI | **Required** | Conversation, transcription, evaluation | France / EU |
| Gradium | **Required** | Examiner voice (en, fr, es, de) | EU endpoint |
| Microsoft Azure (Speech) | **Required** | Examiner voice (nl-BE, it), pronunciation score | West Europe |
| Deepgram | Recommended | Independent transcription for pronunciation score | US by default (see §4) |
| Transactional e-mail (SMTP) | **Required for production** | Password-reset e-mails | Depends on provider |
| Domain name / DNS | **Required** | Production URL | — |
| GitHub | **Required** | Source code, deployments | — |
| Google Cloud (OAuth) | Optional | "Continuer avec Google" sign-in (currently disabled) | US company |
| Anthropic | Optional | Admin-only comparison tools | US |
| Speechace | Optional | Admin-only benchmark import | — |

**Recommended practice for every account:**

- Register it with a **shared company mailbox** (e.g. `tech@…`), not a
  personal address, and add at least two owners/admins.
- Enable **two-factor authentication**.
- Set **billing alerts or spending caps** on all pay-per-use APIs (Mistral,
  Azure, Deepgram, Gradium, Anthropic).
- Sign each provider's **Data Processing Agreement (DPA)** (see §5).

---

## 2. Required accounts

### 2.1 Vercel — hosting

- **Role:** runs the Next.js application: the candidate pages, the admin pages
  and all server routes (`/api/*`). Every audio clip and transcript passes
  through these server routes.
- **Plan:** **Pro** — the free Hobby plan does not allow commercial use.
- **Takeover:** either transfer the existing `elao-speaking` project to the
  client's Vercel team, or create a new project linked to the client's GitHub
  repository.
- **Configuration:**
  - Copy all environment variables (Settings → Environment Variables).
  - **Settings → Functions → Function Region: `dub1` (Dublin)** — see §4.
  - Add the production domain (Settings → Domains).
  - Optional: a rate-limit rule in the Vercel Firewall for a strict quota on
    the public API routes (the built-in limit is per server instance only).

### 2.2 Supabase — database, authentication, storage

- **Role:**
  - **Postgres database:** sessions, answers, evaluations, user profiles and
    roles, per-language settings, satisfaction survey answers.
  - **Auth:** candidate and admin accounts (e-mail + password, optional Google).
  - **Storage:** private `recordings` bucket holding the audio of every session.
- **Current project:** "ELAO POC", region **eu-west-1 (Ireland)**.
- **Plan:** **Pro** recommended for production (daily backups, no automatic
  pausing of inactive projects).
- **Takeover — two options:**
  1. **Transfer the project** to an organisation owned by the client
     (Project Settings → General → Transfer project). Keeps all data, keys and
     settings. *Recommended.*
  2. **New project** in an EU region, then run the SQL files in
     `supabase/migrations/` in numerical order in the SQL Editor and create
     the private `recordings` bucket. Existing data is not carried over.
- **Environment variables:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  (Project Settings → API).
- **Dashboard settings to check:**
  - Authentication → Providers → Email: "Confirm email" **off**, minimum
    password length **8**.
  - Authentication → URL Configuration → Redirect URLs:
    `https://<domain>/auth/callback` (and `http://localhost:3000/auth/callback`
    for development).
  - Authentication → SMTP: a custom SMTP provider (see §2.6).
- **First administrator:** see "Comptes administrateurs" in the README (one SQL
  statement).
- **Recommendation:** create a **second, separate project for development**.
  Today the same project serves development and production, so analysis
  scripts and the simulator read and write real candidate data.

### 2.3 Mistral AI — conversation, transcription, evaluation

- **Console:** https://console.mistral.ai/
- **Role:** the core of the test.
  - The examiner's (Léa's) questions and follow-ups.
  - Topic tracking and the per-answer level judge.
  - Live speech-to-text (Voxtral realtime) and its fallback (Voxtral).
  - The final CEFR evaluation.
  - The judge in the pronunciation score.
- **Environment variables:** `MISTRAL_API_KEY` (required); `MISTRAL_MODEL`,
  `MISTRAL_CHAT_MODEL`, `MISTRAL_PRONUNCIATION_MODEL`,
  `MISTRAL_TRANSCRIBE_MODEL`, `MISTRAL_REALTIME_TRANSCRIBE_MODEL`,
  `MISTRAL_VOXTRAL_MODEL` (optional model choices — see README).
- **Note:** this is the largest variable cost. Choose a paid tier with rate
  limits that match the expected number of simultaneous candidates.

### 2.4 Gradium — examiner voice (en, fr, es, de)

- **Website:** https://gradium.ai/
- **Role:** text-to-speech for Léa's voice in English, French, Spanish and
  German. Uses the EU endpoint (`eu.api.gradium.ai`).
- **Environment variable:** `GRADIUM_API`.

### 2.5 Microsoft Azure — Speech service

- **Portal:** https://portal.azure.com/
- **Role:**
  - Léa's voice in Dutch (Belgium) and Italian, which Gradium does not cover.
  - The acoustic part of the pronunciation score (Azure Pronunciation
    Assessment), for every language.
- **Setup:** an Azure subscription → create a **Speech** resource in
  **West Europe** → copy key and region.
- **Environment variables:** `AZURE_SPEECH_KEY`,
  `AZURE_SPEECH_REGION=westeurope`.

### 2.6 Transactional e-mail (SMTP) — *to set up*

- **Role:** sends password-reset e-mails through Supabase Auth.
- **Why it is needed:** Supabase's built-in mailer only sends a handful of
  e-mails per hour and is meant for testing; in production, password resets
  would silently stop arriving.
- **Setup:** create an account with an SMTP provider, verify the sending
  domain (SPF/DKIM DNS records), then enter the SMTP credentials in Supabase →
  Authentication → SMTP Settings.
- **EU-based options:** Brevo (France), Mailjet (France), Scaleway
  Transactional E-mail (France).

### 2.7 Domain name / DNS

- **Role:** production URL.
- **Setup:** point the domain to Vercel, and add
  `https://<domain>/auth/callback` to Supabase's Redirect URLs. DNS is also
  where the SMTP provider's SPF/DKIM records go.

### 2.8 GitHub — source code

- **Role:** source repository; Vercel deploys from it.
- **Takeover:** transfer the repository to the client's organisation, then
  reconnect it in Vercel. No secrets are stored in the repository (`.env` is
  git-ignored; only `.env.example` is committed).

---

## 3. Recommended and optional accounts

### 3.1 Deepgram — independent transcription (recommended)

- **Console:** https://console.deepgram.com/
- **Role:** produces a second, independent transcription (model `nova-3`) used
  in the pronunciation score. Without it, the score falls back to Azure's
  acoustic result alone (less reliable).
- **Environment variable:** `DEEPGRAM_API_KEY`.
- **GDPR:** see §4 — two settings to change.

### 3.2 Google Cloud — "Continue with Google" sign-in (optional, disabled)

- **Console:** https://console.cloud.google.com/
- **Role:** lets candidates sign in with their Google account. The button is
  visible but disabled today.
- **To enable:**
  1. Create a Google Cloud project → configure the **OAuth consent screen**
     (app name, logo, privacy policy URL, authorised domain).
  2. Create an **OAuth client ID** (type "Web application") with the redirect
     URI shown in Supabase → Authentication → Providers → Google.
  3. Paste the client ID and secret into Supabase and enable the provider.
  4. Set `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true` in Vercel and redeploy.
- **Data shared:** name and e-mail address only.

### 3.3 Anthropic (Claude) — admin tools only (optional)

- **Console:** https://console.anthropic.com/
- **Role:** used only in the admin area: alternative evaluations for comparison
  (eval lab) and the simulated candidate in the conversation simulator.
  **Never used during a real candidate session.**
- **Environment variables:** `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`.
- **If not needed:** leave the key empty; those admin buttons will just show an
  error.

### 3.4 Speechace — benchmark import (optional)

- **Role:** the admin page "Import Speechace" pulls results from Speechace
  report URLs to compare them with ELAO's scores. Benchmarking only; no API
  key required.

### 3.5 ELAO's own systems — score callback (disabled, to finalise)

- **Role:** sends each final score to the client's system, signed with
  HMAC-SHA256. Built but disabled until the client provides the receiving
  side — see **§5 Integration with the client's system**.
- **Environment variables:** `SCORE_CALLBACK_URL`, `SCORE_CALLBACK_SECRET`.

### 3.6 Not an external service: the 3D avatar

The examiner avatar is a local file, `public/avatars/woman_2.glb`, rendered in
the browser by open-source libraries (`@met4citizen/talkinghead`,
`wawa-lipsync`). No account or external service is involved. To change the
avatar, replace that file with any GLB model exposing the ARKit and Oculus
viseme blendshapes.

---

## 4. GDPR and EU data residency

### 4.1 Data processed

| Data | Where it is stored | Who processes it |
|---|---|---|
| Candidate voice recordings | Supabase Storage (Ireland) | Vercel, Mistral, Azure, Deepgram |
| Transcripts, CEFR results, scores | Supabase database (Ireland) | Vercel, Mistral (Anthropic for admin comparisons) |
| E-mail address, password hash | Supabase Auth (Ireland) | Supabase, SMTP provider, Google (if Google sign-in is used) |
| Visitor IP address | — | Vercel, Google Fonts (see below) |

Voice recordings are personal data. They are **not** used to identify people
(no voice biometrics), so they are not "special category" data.

### 4.2 Provider-by-provider assessment

| Provider | Company | Processing location | Assessment | Action / alternative |
|---|---|---|---|---|
| Mistral AI | France | EU | ✅ Compliant | Sign DPA; check that API data is excluded from model training in the console. |
| Gradium | France | EU endpoint | ✅ Compliant | Sign DPA. |
| Azure Speech | US (Microsoft) | West Europe, within the EU Data Boundary | ✅ Compliant | DPA included in Microsoft's Product Terms. |
| Supabase | US | Ireland | ✅ Compliant | Sign DPA (dashboard → Legal documents). Fully EU-owned alternative: self-hosted Supabase on Scaleway or OVHcloud (significant operational effort). |
| **Vercel** | US | **US (Washington, `iad1`) by default** | ⚠️ **Action required** | Set Function Region to **`dub1` (Dublin)** next to the database, so audio and transcripts are processed in the EU. Sign DPA. EU-owned alternatives: Scaleway, Clever Cloud, OVHcloud. |
| **Deepgram** | US | **US endpoint** (`api.deepgram.com`) | ⚠️ **Action required** | (1) Use the EU endpoint `api.eu.deepgram.com` (check availability on the chosen plan). (2) Add `mip_opt_out=true` to requests — otherwise Deepgram may use the audio to improve its models. Both changes are in `lib/pronunciation/providers/azure-ensemble.ts`. Alternatives: remove Deepgram and use Mistral Voxtral for the independent transcription, or Gladia (France). |
| **Google Fonts** | US | Fonts loaded from `fonts.googleapis.com` | ⚠️ **Action required** | Each visit sends the visitor's IP address to Google without consent — a German court fined a website over this in 2022. Fix: self-host the fonts (`next/font/google` bundles them at build time) in `app/layout.tsx`. |
| Anthropic | US | US | ⚠️ Admin only | Real transcripts are sent when the eval lab is used. Sign DPA (transfers under SCCs), or leave the key unset. |
| Google OAuth | US | US | ✅ Acceptable | Name and e-mail only; covered by the EU–US Data Privacy Framework. List it in the privacy policy. |
| SMTP provider | — | — | — | Choose an EU provider (Brevo, Mailjet, Scaleway). |

Once the three ⚠️ actions on Vercel, Deepgram and Google Fonts are done (each
under one hour), **all candidate data is processed and stored within the EU**.

### 4.3 Gaps in the application itself

| # | Gap | Recommendation |
|---|---|---|
| 1 | **No privacy notice.** Candidates are recorded without being told why, for how long, or by whom. | Add a privacy policy page and a short notice before the microphone test (purpose, retention, processors, rights, contact). |
| 2 | **No retention limit.** Recordings, transcripts and results are kept indefinitely, including for anonymous candidates. | Define a retention period (e.g. 12 months) and automate deletion (scheduled Supabase job deleting old sessions and their audio). |
| 3 | **No self-service data rights.** Deletion or export of a candidate's data is only possible manually by an admin. | Add "delete my account / my data" in the candidate dashboard, or document the manual procedure and a contact address. |
| 4 | **Development and production share one database.** | Create a separate development project (see §2.2). |

### 4.4 Paperwork for the client (data controller)

- **Record of processing activities** (GDPR Article 30) describing the
  oral-assessment processing.
- **Signed DPAs** with every processor listed in §4.2.
- **Sub-processor list** to provide to the client's own customers (schools,
  companies) — §4.2 can serve as a starting point.
- A **Data Protection Impact Assessment (DPIA)** is advisable if the test is
  used at scale or for decisions with significant consequences (hiring,
  admission).

---

## 5. Integration with the client's system — to finalise

The test is designed to be launched from the client's own platform (e.g.
elao-test.com) and to send the result back to it. Both directions exist in the
code but **cannot be finalised until the client provides the information
below**.

### 5.1 Inbound: launching a test with a starting CEFR level

**What exists today:** an invitation link sets the starting level of the
conversation:

```
https://<domain>/?level=B1
```

Accepted values: `A1`, `A2`, `B1`, `B2`, `C1`, `C2` (anything else is ignored).
Without the parameter, the per-language default set in the admin
(Conversation settings) applies. The candidate still chooses the language on
the home page.

**What is missing:** the link carries **no candidate or test identifier**. The
result sent back (§5.2) only contains ELAO's internal session ID and, if the
candidate created an account, ELAO's internal user ID. **The client's system
therefore cannot tell which of its candidates a result belongs to.**

**To be decided with the client, then developed:**

| Question | Example |
|---|---|
| Which identifier does the client's system pass in the link? | `?ref=<candidate or order ID>` |
| Should the language also be imposed by the link? | `?lang=fr` (skips the language choice) |
| Must the candidate create an account, or is the test anonymous? | Anonymous today; account optional |
| Should the link be protected against tampering (candidate changing the level or ID)? | Link signed by the client's system with a shared secret, or single-use token |

Development needed: store the identifier on the session and return it in the
callback (and, if requested, the language parameter and link signature).

### 5.2 Outbound: score callback to the client's URL

**What exists today** (`lib/score-callback.ts`): when a session is completed,
the server sends a `POST` with this JSON body to the configured URL:

```json
{
  "event": "session.completed",
  "session_id": "…",
  "user_id": "… or null",
  "language": "fr",
  "duration_seconds": 312,
  "completed_at": "2026-10-19T14:03:00.000Z",
  "level": "B2",
  "score": 74,
  "confidence": "…",
  "axes": {
    "pronunciation": 78,
    "fluency": 70,
    "vocabulary_grammar": 75,
    "communication": 80
  },
  "report_url": "https://<domain>/admin/<session_id>"
}
```

- **Authentication:** header `X-Elao-Signature: sha256=<HMAC-SHA256 of the raw
  body>`, computed with a secret shared between both systems. The receiver
  must recompute the HMAC and reject the request if it doesn't match.
- **Delivery:** 5-second timeout, up to 3 attempts (after 1 s and 2 s) on
  network errors and 5xx responses; no retry on 4xx. The receiver should
  answer `2xx` quickly and be idempotent (the same `session_id` may arrive
  twice).
- **Status:** **disabled** (`enabled: false`). The default URL
  `https://www.elao-test.com/callback` is a placeholder.
- **Note:** `report_url` points to the ELAO admin page, which only ELAO admin
  accounts can open.

**What the client must provide:**

| Item | Detail |
|---|---|
| **Callback URL** | HTTPS endpoint of their system, one for production and ideally one for testing |
| **Authentication method** | Confirm the HMAC signature (then agree on a shared secret, exchanged securely), or ask for another method (bearer token, API key) |
| **Expected fields** | Confirm the payload above, or list fields to add, remove or rename — including the candidate identifier from §5.1 |
| **Events** | Only `session.completed` today; e.g. "session abandoned" would need development |
| **Report access** | Whether their users need to see the detailed report (today: ELAO admin only) |
| **Technical contact** | Someone to test the receiving endpoint with |

**Activation steps (once the above is received):**

1. Develop the identifier pass-through (§5.1) and any payload changes.
2. Set `SCORE_CALLBACK_URL` and `SCORE_CALLBACK_SECRET` in Vercel.
3. Set `enabled: true` in `lib/score-callback.ts` and deploy.
4. Run one real session from a client invitation link and confirm delivery
   (status visible in `/admin/system-config`, attempts in the server logs:
   `score_callback_sent` / `score_callback_failed`).

---

## 6. Handover checklist

**Accounts**

- [ ] Vercel: project transferred / created, Pro plan, region `dub1`
- [ ] Supabase: project transferred to the client's organisation, Pro plan
- [ ] Supabase: separate development project created
- [ ] Mistral: account, API key, billing limit
- [ ] Gradium: account, API key
- [ ] Azure: subscription, Speech resource in West Europe
- [ ] Deepgram: account, API key, EU endpoint + training opt-out
- [ ] SMTP provider: account, domain verified, configured in Supabase
- [ ] Domain: pointed to Vercel, callback URL in Supabase
- [ ] GitHub: repository transferred, reconnected to Vercel
- [ ] *(optional)* Google Cloud OAuth client, Anthropic key

**Security**

- [ ] **Rotate every key and secret** after the handover (Mistral, Gradium,
      Azure, Deepgram, Anthropic, Supabase service-role key,
      `SCORE_CALLBACK_SECRET`, `EVALUATION_SIGNING_SECRET`), then update
      Vercel's environment variables and redeploy
- [ ] Remove the previous developer's access from every account
- [ ] Two-factor authentication on every account
- [ ] First client administrator created (README, "Comptes administrateurs")

**Integration (information from the client — see §5)**

- [ ] Candidate/test identifier to pass in the invitation link
- [ ] Language imposed by the link: yes / no
- [ ] Link protection (signature / single-use token): yes / no
- [ ] Callback URL (production + test)
- [ ] Authentication method confirmed, shared secret exchanged securely
- [ ] Payload fields and events confirmed
- [ ] Access to detailed reports for the client's users: yes / no
- [ ] Technical contact for end-to-end testing
- [ ] Development done, callback enabled, one real session delivered

**GDPR**

- [ ] Google Fonts self-hosted
- [ ] Privacy notice and policy published
- [ ] Retention period defined and automated
- [ ] DPAs signed with every processor
- [ ] Record of processing activities written
