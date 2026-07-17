# CEFR Conversation POC

POC d'évaluation du niveau CEFR (A1-C2) via conversation vocale avec avatar 3D réactif.

## Stack
- **Frontend** : Next.js 15 (App Router) + React 19
- **Avatar** : Avaturn (GLB) + Three.js / react-three-fiber, lip-sync par amplitude — ou HeyGen streaming (optionnel, `NEXT_PUBLIC_HEYGEN_ENABLED=true`)
- **Live STT** : Azure Speech SDK (navigateur, streaming + pronunciation assessment pass-1)
- **LLM conversation + évaluation CEFR + juge de prononciation** : Mistral (`lib/mistral.ts`)
- **TTS** : Azure Neural voices (appelé côté serveur, streamé au client en SSE)
- **Prononciation pass-2** : triangulation Deepgram (verbatim indépendant) + Azure (score acoustique) + Mistral (juge)
- **Persistence** : Supabase — **écriture directe depuis le navigateur avec la clé anon** (pas encore de backend serveur, voir `DEV-PLAN.md`)

## Architecture

```
Browser (app/page.tsx — orchestration mic/avatar/timing)
  ├─ Azure Speech SDK (browser)     → live STT + pass-1 pronunciation
  ├─ MediaRecorder                  → per-turn + session audio
  ├─ fetch /api/chat (SSE)          → Mistral stream + Azure TTS (PCM)
  ├─ fetch /api/pronunciation       → Deepgram + Azure + Mistral judge (pass-2)
  ├─ fetch /api/evaluate            → Mistral CEFR scoring
  └─ Supabase client (browser)      → direct insert to `sessions` + storage upload
```

## Sécurité des clés

Toutes les clés (`AZURE_SPEECH_KEY`, `MISTRAL_API_KEY`, `DEEPGRAM_API_KEY`) ne quittent JAMAIS le navigateur :
- Azure STT : le navigateur appelle `/api/speech-token` → reçoit un token éphémère (TTL 10 min)
- TTS, LLM et prononciation pass-2 sont appelés côté serveur (`/api/chat`, `/api/evaluate`, `/api/pronunciation`)

`NEXT_PUBLIC_SUPABASE_ANON_KEY` est en revanche exposée au navigateur (clé anon, écriture directe — voir limitation ci-dessous).

## Setup

```bash
# 1. Installer
npm install

# 2. Variables d'environnement
cp .env.example .env.local
# Remplir AZURE_SPEECH_KEY, MISTRAL_API_KEY, NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY
# DEEPGRAM_API_KEY et OPENAI_API_KEY sont optionnels

# 3. Lancer
npm run dev
```

Ouvrir http://localhost:3000

## Fichiers clés

| Fichier | Rôle |
|---------|------|
| `app/page.tsx` | UI + orchestration mic/avatar/session |
| `app/api/speech-token/route.ts` | Token Azure STT éphémère |
| `app/api/chat/route.ts` | Mistral stream → Azure TTS, SSE |
| `app/api/evaluate/route.ts` | Évaluation CEFR du transcript (Mistral) |
| `app/api/pronunciation/route.ts` | Triangulation Deepgram + Azure + Mistral judge |
| `lib/mistral.ts` | Client Mistral (chat + completion JSON) |
| `lib/azure-stt.ts` | Client STT navigateur (Azure Speech SDK) |
| `lib/cefr-prompt.ts` | Prompt d'évaluation CEFR |
| `lib/supabase.ts` | Client Supabase (navigateur, clé anon) |
| `components/Avatar.tsx` | Avatar 3D Avaturn avec lip-sync amplitude |
| `components/LiveAvatar.tsx` | Avatar HeyGen (optionnel) |

## Limitation connue (POC)

Pas de backend serveur : les sessions sont écrites directement depuis le navigateur vers Supabase avec la clé anon (pas d'auth, pas de RLS). Voir `DEV-PLAN.md` pour le plan de correction (backend propre + labo d'évaluation multi-modèle).
