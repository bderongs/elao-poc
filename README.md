# ELAO Speaking — évaluation orale CEFR

Test d'expression orale en conversation avec Léa, une examinatrice virtuelle
(avatar 3D animé). Le candidat parle quelques minutes, l'application adapte la
difficulté des questions à ses réponses, puis donne un niveau CEFR (de A0 à
C1+), un score sur 100 et un retour détaillé.

Six langues : anglais, français, néerlandais (Belgique), espagnol, italien,
allemand.

## Parcours candidat

1. **Accueil** (`/`) : choix de la langue, consignes et test du micro. On peut
   passer le test sans compte. Un lien d'invitation peut imposer le niveau de
   départ (`/?level=B1`) ; sinon c'est le niveau de départ réglé par langue dans
   l'admin.
2. **Conversation** : 3 à 7 minutes selon les réponses. Après chaque réponse,
   un juge rapide estime si la question était bien maîtrisée et fait monter ou
   descendre le niveau de la suivante. La session s'arrête quand le niveau est
   établi.
3. **Résultat** : niveau, score sur 100, quatre axes (prononciation, fluidité,
   vocabulaire/grammaire, communication), points forts et axes de progrès.
4. **Compte (facultatif)** : le candidat peut créer un compte (ou se
   connecter) pour garder son résultat ; il retrouve ses sessions sur
   `/dashboard`.

## Modèles utilisés

C'est la configuration **par défaut du code**. Les modèles Mistral se règlent
par variable d'environnement, donc **la référence pour un environnement donné
est la page `/admin/system-config`**, qui affiche les valeurs réellement
utilisées par le serveur. Chaque session enregistre aussi une copie de cette
table : la page de détail d'une session dans l'admin montre ce qu'elle a
réellement utilisé.

### Pendant une session

| Étape | Quand | Fournisseur et modèle | Où ça se règle |
|---|---|---|---|
| **Conversation** — questions, relances et conclusion de Léa | À chaque tour | Mistral, `MISTRAL_CHAT_MODEL` (sinon `MISTRAL_MODEL`, sinon `mistral-large-latest`). Si la réponse de Léa n'a pas de question, ou répète une question, elle est regénérée une fois avec le même modèle. | Variable d'env. |
| **Suivi des thèmes** — change de sujet après deux questions sur le même domaine | À chaque question | Mistral, même modèle que la conversation | Variable d'env. |
| **Juge par réponse (ET)** — réponse maîtrisée ou non, d'où le niveau de la question suivante | À chaque réponse | Mistral, même modèle que la conversation | Variable d'env. |
| **Transcription (STT)** | Pendant que le candidat parle | Mistral realtime `voxtral-mini-transcribe-realtime-2602` (`MISTRAL_REALTIME_TRANSCRIBE_MODEL`), toutes langues. Secours : Mistral `voxtral-mini-latest` (`MISTRAL_TRANSCRIBE_MODEL`) si le flux échoue, coupe une réponse longue, ou si le candidat appuie sur « J'ai terminé ». | `lib/realtime-stt-config.ts` |
| **Voix de Léa (TTS)** | À chaque phrase | Gradium : en (Zoey), fr (Solène), es (Vera), de (Resi). Azure Neural : nl-BE (Dena), it (Elsa), que Gradium ne couvre pas. | `lib/tts/registry.ts` |
| **Prononciation (EO)** | À chaque réponse, en arrière-plan | Trois sources combinées : Deepgram `nova-3` (transcription indépendante), Azure Pronunciation Assessment (score acoustique), et un juge Mistral (`MISTRAL_PRONUNCIATION_MODEL`, sinon `MISTRAL_MODEL`) qui tranche mot par mot. | `lib/pronunciation-rollup.ts` |
| **Évaluation CEFR finale** | Une fois, en fin de session | Mistral, `MISTRAL_MODEL` (sinon `mistral-large-latest`) | `lib/llm/live-provider.ts` |

Le **niveau final** n'est pas directement la sortie du modèle :
`lib/cefr-score.ts` fait la moyenne des quatre axes (la prononciation vient
des moteurs de prononciation ; fluidité, vocabulaire/grammaire et
communication viennent de l'évaluation CEFR), plafonne la fluidité selon le
débit (mots par minute), passe cette moyenne sur 100, puis convertit le
score en niveau (A1 à partir de 40, A2 à 50, B1 à 60, B2 à 70, C1 à 80, avec
un « + » à mi-palier). **Le test ne délivre pas C2** : le score est plafonné à
89 (C1+). Un candidat qui a maîtrisé au moins 2 questions de niveau C2 (selon
le juge par réponse) avec une moyenne des axes d'au moins 8,75 reçoit la
mention « haut de l'échelle ». Les règles actives sont dans
`SCORING_RULES` (`lib/cefr-score.ts`) et expliquées dans l'admin, page
**Scoring guide**.

Un **second avis à la frontière de niveau** (quatre appels de plus au même
modèle que l'évaluation finale, `lib/cefr-boundary.ts`) existe mais est
**désactivé** (`boundaryCheck: "off"` dans `SCORING_RULES`).

### Admin uniquement (jamais pendant une session de candidat)

| Usage | Modèle |
|---|---|
| Comparaison d'évaluations (eval lab, page d'une session) | Mistral `MISTRAL_MODEL`, ou Anthropic `ANTHROPIC_MODEL` (défaut `claude-sonnet-4-5`) |
| Simulateur de conversation : candidat simulé | Mistral (défaut) ou Anthropic ; l'examinatrice et l'évaluation sont les mêmes qu'en session réelle |
| Prononciation : fournisseurs de comparaison | Voxtral `voxtral-small-latest` (`MISTRAL_VOXTRAL_MODEL`), et `azure-intended` (expérimental) |
| Transcription en flux Gradium | Branchée mais désactivée (moins fiable que Mistral sur les sessions testées) |

### Changer un modèle

- **Modèle Mistral** (conversation, juge, évaluation, prononciation) : changer
  la variable d'environnement et redéployer. Aucun code à toucher.
- **Fournisseur** (passer une langue de Gradium à Azure, couper le flux de
  transcription…) : c'est un choix volontaire dans le code, une constante
  dans le fichier indiqué ci-dessus. La page `/admin/system-config` est en
  lecture seule.

Le coût estimé par session sur `/admin/system-config` est approximatif : la
conversation, le suivi des thèmes, les voix Gradium et la transcription en
flux ne sont pas encore chiffrés, et le total n'additionne que les lignes
chiffrées.

## Architecture

```
Navigateur (app/page.tsx — micro, détection de fin de parole, avatar, déroulé)
  ├─ WebSocket Mistral realtime     ← jeton court via /api/realtime-token
  ├─ /api/transcribe                → transcription de secours (Voxtral)
  ├─ /api/chat (flux SSE)           → réponse de Léa (Mistral) + voix (Gradium / Azure)
  ├─ /api/assess-transcript         → juge par réponse (ET)
  ├─ /api/classify-topic            → suivi des thèmes
  ├─ /api/pronunciation             → prononciation (Deepgram + Azure + juge Mistral)
  ├─ /api/sessions/live             → sauvegarde de la session après chaque réponse
  ├─ /api/evaluate                  → évaluation CEFR finale (signée, voir Sécurité)
  ├─ Supabase Storage               ← envoi direct de l'audio, via URLs signées (/api/sessions/audio-urls)
  └─ POST /api/sessions             → enregistrement final
```

- **Next.js 15** (App Router), React 19, hébergé sur Vercel.
- **Supabase** : base Postgres, Auth (e-mail + mot de passe) et Storage
  (enregistrements audio).
- **Avatar** : TalkingHead (`@met4citizen/talkinghead`), synchronisation des
  lèvres en direct à partir de la voix (`wawa-lipsync`).

Toutes les lectures et écritures en base passent par le serveur (clé
service-role, `lib/supabase-server.ts`). Le navigateur n'utilise la clé
publique Supabase que pour la connexion et l'envoi de l'audio par URL signée.

## Sécurité

- **Clés des fournisseurs** : elles restent côté serveur. Les deux connexions
  directes du navigateur (transcription Mistral, et Gradium s'il est réactivé)
  utilisent des jetons de courte durée.
- **Admin** : `middleware.ts` vérifie le rôle `admin` à chaque requête sur
  `/admin/*` et sur les API d'administration. Voir « Comptes
  administrateurs ».
- **Données des candidats** : un candidat connecté ne voit que ses propres
  sessions. Les enregistrements audio sont dans un bucket privé ; les pages
  reçoivent des liens qui expirent après 2 heures (`lib/recordings.ts`).
- **Résultat** : l'enregistrement final ne garde l'évaluation que si elle
  porte la signature de `/api/evaluate` pour ces réponses
  (`lib/evaluation-signature.ts`). Le niveau, le score et les axes sont lus
  dans cette évaluation, jamais dans des champs envoyés à part par le
  navigateur. Une évaluation non vérifiée n'est pas enregistrée (événement
  `session_evaluation_unverified` dans les logs) ; un admin peut relancer
  l'évaluation depuis la page de la session.
- **Limite** : la transcription et le déroulé (niveaux des questions, avis du
  juge par réponse) sont produits dans le navigateur. Un candidat très
  déterminé pourrait donc faire évaluer une transcription inventée. Ce qui
  est garanti, c'est que le score stocké vient bien de notre évaluateur et
  correspond à la transcription stockée, relisible dans l'admin.
- **Points ouverts** : pas encore de limite de débit sur les API publiques
  qui appellent les modèles (`/api/chat`, `/api/evaluate`, `/api/transcribe`,
  `/api/pronunciation`, jetons de transcription) ; à mettre en place (règles
  du pare-feu Vercel ou limiteur par IP) avant une ouverture large.

## Comptes administrateurs

Un administrateur est un compte normal (e-mail + mot de passe) dont la ligne
`profiles` a `role = 'admin'`. Le middleware relit ce rôle à chaque requête :
un changement prend effet immédiatement, sans reconnexion.

Le compte doit d'abord exister : la personne s'inscrit via `/login` (onglet
« Créer un compte »), ou on la crée dans Supabase (Authentication → Users →
Add user). Le mot de passe peut ensuite être défini depuis `/admin/users`.

**Depuis l'admin (en étant soi-même admin)** : `/admin/users` → bouton
**Make admin** sur la ligne de l'utilisateur (**Revoke admin** pour retirer
le droit). On ne peut pas retirer son propre accès admin.

**Directement en base** (Supabase → SQL Editor) — utile pour le tout premier
admin, ou si plus personne n'a accès à l'admin :

```sql
-- Donner les droits admin (crée la ligne profiles si elle manque)
insert into profiles (id, role)
select id, 'admin' from auth.users where email = 'prenom.nom@exemple.com'
on conflict (id) do update set role = 'admin';

-- Retirer les droits admin
update profiles set role = 'user'
where id = (select id from auth.users where email = 'prenom.nom@exemple.com');

-- Lister les admins
select u.email, p.created_at
from profiles p join auth.users u on u.id = p.id
where p.role = 'admin';
```

Le rôle ne peut être modifié que côté serveur (clé service-role) ou depuis le
SQL Editor : la migration `0014_profiles_role_lockdown.sql` interdit toute
écriture sur `profiles` avec la clé publique du navigateur.

## Installation locale

```bash
npm install
cp .env.example .env   # puis remplir les clés (voir ci-dessous)
npm run dev            # http://localhost:3000
```

Réglages Supabase nécessaires (tableau de bord du projet) :

- **Authentication → Providers → Email** : « Confirm email » désactivé
  (l'inscription connecte directement), mot de passe de 8 caractères minimum.
- **Authentication → URL Configuration → Redirect URLs** :
  `http://localhost:3000/auth/callback` et `https://<domaine>/auth/callback`.
  L'e-mail de réinitialisation du mot de passe en dépend.

## Variables d'environnement

Le détail de chaque variable est dans `.env.example`.

| Variable | Rôle | |
|---|---|---|
| `MISTRAL_API_KEY` | Conversation, transcription, juges, évaluation | Obligatoire |
| `GRADIUM_API` | Voix en/fr/es/de | Obligatoire |
| `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` | Voix nl-BE/it, score acoustique de prononciation | Obligatoire |
| `DEEPGRAM_API_KEY` | Transcription indépendante pour la prononciation | Recommandé (sans elle, score Azure seul) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Accès serveur à la base et au stockage | Obligatoire |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Connexion des utilisateurs depuis le navigateur | Obligatoire |
| `MISTRAL_MODEL`, `MISTRAL_CHAT_MODEL`, `MISTRAL_PRONUNCIATION_MODEL`, `MISTRAL_TRANSCRIBE_MODEL`, `MISTRAL_REALTIME_TRANSCRIBE_MODEL`, `MISTRAL_VOXTRAL_MODEL` | Choix des modèles (voir « Modèles utilisés ») | Facultatif |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Comparaisons et simulateur (admin) | Facultatif |
| `EVALUATION_SIGNING_SECRET` | Clé de signature des évaluations (dérivée de la clé service-role par défaut) | Facultatif |
| `SCORE_CALLBACK_URL`, `SCORE_CALLBACK_SECRET` | Envoi du score à un système externe (désactivé dans `lib/score-callback.ts`) | Facultatif |
| `NEXT_PUBLIC_SATISFACTION_MODAL` | `1` = questionnaire de satisfaction après le résultat | Facultatif |
| `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED` | `true` = bouton « Continuer avec Google » actif | Facultatif |
| `NEXT_PUBLIC_AVATAR_GLB_URL` | Avatar 3D (défaut : `public/avatars/woman_2.glb`) | Facultatif |

## Base de données

Un seul projet Supabase sert au développement et à la production : les
scripts d'analyse et le simulateur lisent et écrivent de vraies données.

Le schéma est dans `supabase/migrations/`, numéroté dans l'ordre. Les
migrations s'appliquent à la main, dans le SQL Editor de Supabase, une seule
fois chacune.

| Table | Contenu |
|---|---|
| `sessions` | Une ligne par session : langue, statut, transcription, évaluation, score, déroulé des niveaux, modèles utilisés |
| `session_turns` | Les tours de parole d'une session terminée, avec leur audio et leur prononciation |
| `session_evaluations`, `session_turn_evaluations` | Évaluations relancées depuis l'admin (comparaisons) |
| `profiles` | Rôle (`user` / `admin`) et dernière langue/niveau de chaque compte |
| `conversation_settings` | Niveau de départ et pas d'ajustement, par langue |
| `session_feedback` | Réponses au questionnaire de satisfaction |

Storage : bucket privé `recordings` (audio de chaque session et de chaque
réponse).

## Pages d'administration

| Page | Usage |
|---|---|
| Sessions (`/admin`) | Liste des sessions, détail avec transcription, audio, scores, déroulé et comparaisons de modèles |
| Upload recording | Évaluer un enregistrement envoyé à la main |
| Import Speechace | Importer des résultats Speechace pour les comparer aux nôtres |
| Scoring guide | Règles de calcul du niveau et du score |
| Conversation simulator | Faire passer le test à un candidat simulé d'un niveau donné |
| Question bank | Les questions par niveau |
| Users | Comptes, droits admin, mots de passe |
| Conversation settings | Niveau de départ et pas d'ajustement par langue |
| System configuration | Modèles utilisés, envoi du score, questionnaire |

## Scripts et analyse

Outils hors ligne pour mesurer l'effet d'un changement sur les sessions
existantes (scoring, calibration, transcription, simulations) : voir
[`analysis/README.md`](analysis/README.md).

## Structure du code

| Dossier | Contenu |
|---|---|
| `app/page.tsx` | Toute l'expérience candidat (accueil, conversation, résultat) |
| `app/api/` | Routes serveur (voir « Architecture ») |
| `app/admin/`, `app/dashboard/`, `app/login/` | Admin, espace candidat, connexion et mot de passe oublié |
| `lib/stt/`, `lib/tts/`, `lib/et/`, `lib/pronunciation/`, `lib/llm/` | Un registre par étape : les fournisseurs disponibles et celui qui est actif |
| `lib/system-config.ts` | Rassemble ces registres pour `/admin/system-config` |
| `lib/examiner-prompt.ts`, `lib/question-bank/` | Consignes de Léa et banque de questions par niveau |
| `lib/cefr-prompt.ts`, `lib/cefr-score.ts` | Consignes de l'évaluation finale et calcul du niveau |
| `lib/sessions-service.ts` | Lecture et écriture des sessions |
| `doc/` | Spécifications, plans de développement, retours client |
