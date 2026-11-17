# Modèles Mistral dans l'assessment — état, évolutions et tests du 2026-11-16

But de ce document : permettre à un relecteur (humain ou IA) de vérifier, code en main, quel modèle sert à quoi, pourquoi le quota Mistral bloque l'évaluation des sessions Speechace importées, et ce que disent les tests de remplacement de `mistral-large-2512` menés le 16 novembre 2026.

Branche : `roadmap-nov-2026`. Les chemins et numéros de ligne renvoient à l'état du dépôt au 16 novembre 2026.

---

## 1. Point d'entrée commun : `lib/mistral.ts`

Tous les appels texte passent par `mistralComplete()` (`lib/mistral.ts:228`) ou `mistralStreamText()` (`lib/mistral.ts:339`). La transcription passe par `mistralTranscribe()` (`lib/mistral.ts:272`).

| Élément | Où | Rôle |
|---|---|---|
| `MISTRAL_LARGE_MODEL = "mistral-large-2512"` | `lib/mistral.ts:45` | Modèle large figé (voir §3) |
| `mistralModel()` | `lib/mistral.ts:47` | `MISTRAL_MODEL`, sinon le modèle large figé |
| `mistralChatModel()` | `lib/mistral.ts:58` | `MISTRAL_CHAT_MODEL`, puis `MISTRAL_MODEL`, sinon le modèle large figé |
| `mistralTranslationModel()` | `lib/mistral.ts:63` | `MISTRAL_TRANSLATION_MODEL`, sinon `mistral-small-latest` |
| `mistralPronunciationModel()` | `lib/mistral.ts:67` | `MISTRAL_PRONUNCIATION_MODEL`, puis `MISTRAL_MODEL`, sinon le modèle large figé |
| `mistralVoxtralModel()` | `lib/mistral.ts:76` | `MISTRAL_VOXTRAL_MODEL`, sinon `voxtral-small-latest` |
| `mistralTranscribeModel()` | `lib/mistral.ts:85` | `MISTRAL_TRANSCRIBE_MODEL`, sinon `voxtral-mini-latest` |
| `mistralRealtimeTranscribeModel()` | `lib/mistral.ts:96` | `MISTRAL_REALTIME_TRANSCRIBE_MODEL`, sinon `voxtral-mini-transcribe-realtime-2602` |
| `contentText()` | `lib/mistral.ts:218` | Lit une réponse texte ou en blocs (garde `text`, ignore `thinking`) |
| `postWithRetry()` | `lib/mistral.ts:171` | 3 essais (`MAX_ATTEMPTS`, `lib/mistral.ts:111`) sur 429/5xx, attente de 0,5 à 5 s |
| `withMistralSlot()` | `lib/mistral-queue.ts:34` | Au plus 2 appels Mistral simultanés par processus (`MISTRAL_MAX_CONCURRENCY`) |

Les valeurs ci-dessus sont celles du code. Les variables d'environnement de la prod n'ont pas été vérifiées. En local, `.env` ne fixe que `MISTRAL_CHAT_MODEL=mistral-small-latest`.

---

## 2. Quel modèle pour quelle tâche

### 2.1 Pendant la session (en direct)

| Tâche | Modèle (par défaut) | Code |
|---|---|---|
| Examinateur (questions) | `mistralChatModel()` | `app/api/chat/route.ts:153` et `:182` |
| Niveau estimé tour par tour (« échelle ») | `mistralChatModel()` | `assessTranscript()`, `lib/level-assessment.ts:62` |
| Suivi des sujets | `mistralChatModel()` | `classifyTopicDomain()`, `lib/topic-tracking.ts:42` |
| Transcription en direct (navigateur ↔ Mistral par WebSocket) | `voxtral-mini-transcribe-realtime-2602` | `app/api/realtime-token/route.ts:17` |
| Transcription STT par lot | `voxtral-mini-latest` | `lib/stt/providers/voxtral.ts:23` |

### 2.2 Note de prononciation (par tour)

Moteur en direct : `azure-ensemble` pour toutes les langues (`LIVE_CONVERSATION_PRONUNCIATION_PROVIDER_BY_LANG`, `lib/pronunciation-rollup.ts:31`). La route est `app/api/pronunciation/route.ts:40`.

Déroulé dans `assess()` (`lib/pronunciation/providers/azure-ensemble.ts:281`) :

1. **Deux écoutes indépendantes, en parallèle :**
   - **Transcription mot à mot** : `verbatimHearing()` (`lib/pronunciation/verbatim.ts:133`). Le moteur par défaut est `LIVE_VERBATIM_ENGINE = "voxtral-transcribe"` (`lib/pronunciation/verbatim.ts:31`), qui appelle `mistralTranscribe()` avec **`voxtral-mini-latest`**. On peut revenir à Deepgram avec `PRONUNCIATION_VERBATIM_ENGINE=deepgram`.
   - **Note acoustique Azure** : `azureAcoustic()` (`azure-ensemble.ts:64`), Azure Pronunciation Assessment en parole libre.
2. **Juge** : `judge()` (`azure-ensemble.ts:211`) appelle `mistralComplete()` avec **`mistralPronunciationModel()` = `mistral-large-2512`** et `max_tokens` 2000.
   - Le prompt système est `JUDGE_SYSTEM` (`azure-ensemble.ts:135`).
   - Le message utilisateur est construit par `buildJudgeEvidence()` (`azure-ensemble.ts:183`) : transcription affichée, transcription mot à mot, notes acoustiques, question de l'examinateur.
   - La réponse est lue par `parseJudgeReply()` (`azure-ensemble.ts:204`).
   - **Le juge n'entend pas l'audio**, il raisonne uniquement sur du texte.
3. **Score final** : `scoreFromVerdict()` (`azure-ensemble.ts:256`) applique le plafond selon les verdicts mot par mot, puis les « jokers » (`applyPronunciationForgiveness`). Si le juge échoue, le score retombe sur Azure seul.

Autres moteurs, disponibles en comparaison depuis l'admin seulement :

- **`voxtral`** (`lib/pronunciation/providers/voxtral.ts:98`) : un seul appel à `voxtral-small-latest` avec l'audio, qui transcrit et note à la fois. Il a été retiré du direct le 9 septembre 2026 parce qu'il inventait des transcriptions puis les notait comme bien prononcées (voir le commentaire `lib/pronunciation-rollup.ts:5-29`).
- **`azure-intended`** (`lib/pronunciation/providers/azure-intended.ts:78`) : utilise aussi `mistralPronunciationModel()`. Il est marqué « comparaison seulement » (`lib/pronunciation-rollup.ts:48`).

### 2.3 Évaluation CECRL (fin de session)

**En direct :** `POST` dans `app/api/evaluate/route.ts:39`.

1. `provider.complete()` (`:52`), avec le fournisseur `mistral` (`lib/llm/providers/mistral.ts`) qui utilise `mistralModel()` = **`mistral-large-2512`**.
   - `max_tokens` : 1500.
   - Prompt système : `CEFR_SYSTEM_PROMPT` (`lib/cefr-prompt.ts:40`, version `v9`).
   - Message utilisateur : `buildEvaluationUserMessage()` (`lib/cefr-prompt.ts:204`).
2. Post-traitements, dans l'ordre :
   - `parseCefrEvaluation()` (`:259`) ;
   - `withAnswerEvidence()` (`:281`) ;
   - `withC2Evidence()` (`:296`) ;
   - `fluencyFromWpm()` (`lib/cefr-score.ts:234`).
3. Score et niveau affichés : `computeCompositeCefrScore()` (`lib/cefr-score.ts:396`), selon les règles `SCORING_RULES` (`lib/cefr-score.ts:162`). Le second avis aux limites de niveau est désactivé (`boundaryCheck: "off"`), il n'ajoute donc aucun appel.
4. Traduction du retour : `withAnalysesFor()` (`lib/analysis-translation.ts:162`) avec **`mistral-small-latest`**.

**Depuis l'admin :** `runCefrEvaluation()` (`lib/cefr-eval.ts:71`), même prompt et même modèle. Le résultat est écrit dans `session_evaluations`.

### 2.4 Sessions Speechace importées

- **L'import ne fait aucun appel Mistral.** `POST /api/sessions/speechace-import` (`app/api/sessions/speechace-import/route.ts:17`) appelle `createSpeechaceImportSessions()` (`lib/sessions-service.ts`), qui télécharge le rapport et l'audio, avec 4 imports simultanés au plus (`SPEECHACE_IMPORT_CONCURRENCY`, `:911`).
- **Les appels Mistral partent ensuite**, quand on lance l'évaluation complète : `POST /api/sessions/:id/assess-all` (`app/api/sessions/[id]/assess-all/route.ts:40`), déclenché depuis `components/FullEvaluationPanel.tsx:191`. Ce traitement juge chaque tour avec audio (2 tours à la fois, `TURN_CONCURRENCY`, `:16`) via `assessTurn()`, puis lance `runCefrEvaluation()`.
- **Par tour**, avec les moteurs `azure-ensemble` et `azure-intended`, on compte 1 transcription Voxtral et 1 appel au juge sur `mistral-large-2512` par moteur. Le quota de `mistral-large-2512` est donc vite épuisé (§4).

---

## 3. Évolutions récentes

| Date | Commit | Changement |
|---|---|---|
| 2026-09-09 | (voir le commentaire `lib/pronunciation-rollup.ts`) | `voxtral` retiré du direct ; `azure-ensemble` partout |
| ~2026-11-15 | — (côté Mistral) | L'alias `mistral-large-latest` passe de `mistral-large-2512` à **Mistral Large 4**, un modèle à raisonnement. Les réponses arrivent en blocs `thinking` + `text`, le parseur levait `Mistral: empty response`, et le raisonnement épuisait `max_tokens`. Conséquences : juge retombé sur Azure seul, évaluation CECRL et simulateur en échec. |
| 2026-11-15 | `25bc1ba` (master : `3faccb0`) | **On fige `mistral-large-2512`** (`lib/mistral.ts:37-45`), le modèle sur lequel prompts et règles ont été calibrés. `contentText()` sait désormais lire les blocs. `lib/session-cost.ts` reçoit le prix de 2512. |
| 2026-11-16 | `32993ca`, `9a3c499`, `3dff401` | A-01 à A-03 : la transcription mot à mot du juge passe de Deepgram nova-3 à **Voxtral transcription** (`voxtral-mini-latest`). Deepgram reste disponible pour revenir en arrière. Rejeu : `scripts/verbatim-replay.ts`. |
| 2026-11-16 | non commité | Refactor sans changement de comportement de `azure-ensemble.ts` : `buildJudgeEvidence`, `parseJudgeReply` et `scoreFromVerdict` sont exportés pour le script de test (§5). |

---

## 4. Le problème de quota (429)

**Erreur en prod lors de l'évaluation d'une session Speechace :**

```
MistralHttpError: Mistral API 429: {"type":"rate_limited","code":"1300"}
```

**Quotas mesurés** avec un appel minimal par modèle, sur la clé de `.env.local`. Mistral les renvoie dans les en-têtes `x-ratelimit-*`.

| Modèle | Requêtes / min | Tokens / min |
|---|---|---|
| **`mistral-large-2512`** | **15** | 400 k |
| `mistral-large-latest` (Large 4) | 1 000 | 15 M |
| `mistral-small-latest` | 100 | 100 k |
| `voxtral-small-latest` | 360 | 200 k |
| `zai-glm-5-3-flash` | 333 | 10,7 M |

**Ce qu'on observe dans les logs :** `logs/server-2026-11-15.log` contient 65 événements `mistral_error`, tous en 429 sur `pronunciation-judge` / `mistral-large-2512`. Leurs en-têtes indiquent `x-ratelimit-limit-req-minute: 15` et `remaining: 0`, sans `Retry-After`.

**Cause :**

- Le passage à 2512 a divisé le quota disponible par environ 65.
- `postWithRetry()` abandonne après environ 2 s, alors que la fenêtre de quota dure 1 minute.
- `assess-all` envoie plusieurs appels au juge par tour.

**Limites de cette vérification :**

- La clé de prod n'a pas été testée ; ses quotas peuvent être différents. Les logs de prod contiennent les mêmes en-têtes.
- Si `MISTRAL_CHAT_MODEL` n'est pas définie en prod, l'examinateur en direct partage lui aussi ce quota de 15 requêtes par minute.

---

## 5. Tests de remplacement de `mistral-large-2512` (16 novembre 2026)

### 5.1 Méthode

**Script :** `scripts/judge-model-replay.ts`. Il ne fait que lire la base. Il se lance avec Node ≥ 22 :

```
npx tsx scripts/judge-model-replay.ts [--candidate l4|small|glm-flash] [--effort low] [--no-noise] [--rpm-2512 N]
```

**Échantillon :**

- les 2 sessions les plus récentes par langue (fr, en, nl-BE, es, it, de) depuis le 30 septembre 2026, hors simulations, avec `evaluation_json` non nul ;
- jusqu'à 6 tours par session, ceux qui ont un audio et au moins 4 mots ;
- au final, **10 sessions et 51 tours** : aucune session italienne ne remplissait les conditions.

**Juge de prononciation :**

- Les éléments d'entrée (`verbatimHearing` avec Voxtral + `azureAcoustic`) sont collectés **une seule fois par tour**. Le **même** message (`buildJudgeEvidence`) est ensuite envoyé à chaque modèle, avec le même `JUDGE_SYSTEM`.
- Le score est calculé avec la fonction de prod `scoreFromVerdict`.

**Évaluation CECRL :**

- Elle reprend les étapes de `app/api/evaluate/route.ts` : `CEFR_SYSTEM_PROMPT`, `buildEvaluationUserMessage`, `parseCefrEvaluation`, `withAnswerEvidence`, `withC2Evidence`, puis `computeCompositeCefrScore`.
- Elle utilise la transcription et les `pronunciation_scores` **stockés** de la session. La traduction n'est pas rejouée.

**Mesure du bruit :** 2512 est rejoué deux fois (`2512` et `2512-bis`). L'écart entre ces deux passages mesure sa variabilité propre et sert d'étalon pour lire les écarts des autres modèles.

**Réglages des modèles :**

- 2512 utilise les budgets de prod (juge 2 000, évaluation CECRL 1 500 tokens).
- Les modèles à raisonnement reçoivent une marge supplémentaire : +6 000 tokens pour Large 4, +4 000 pour GLM.
- Tous les appels utilisent `response_format: json_object`.
- 2512 est limité côté script à 3 à 5 requêtes par minute, pour ne pas épuiser le quota partagé avec la prod.

**Prix utilisés** (en dollars par million de tokens envoyés / générés ; le raisonnement est facturé comme des tokens générés) :

| Modèle | Prix | Source |
|---|---|---|
| 2512 | 0,50 / 1,50 | `lib/session-cost.ts` |
| small | 0,15 / 0,60 | `lib/session-cost.ts` |
| Large 4 | 0,70 / 2,10 | listes tierces, **non confirmé** |
| GLM 5.3 Flash | 0,15 / 0,50 | prix public Z.ai, **non confirmé** pour Mistral |

**Ce qui n'est pas comparable entre les tests :** chaque test recollecte les transcriptions et les notes acoustiques, qui peuvent varier légèrement. Les candidats ne se comparent donc entre eux qu'à travers leur écart à 2512 dans leur propre test.

### 5.2 Juge de prononciation, écart à 2512 (score du tour, 0 à 100)

| Candidat | Tours | Écart moyen | Écart moyen en valeur absolue | Tours à plus de 5 pts | Même verdict par mot | Échecs |
|---|---|---|---|---|---|---|
| **2512, second passage (bruit)** | 51 | +0,1 | **2,1** | 4/51 | **96,2 %** | 0 |
| Large 4, `reasoning_effort: low` | 51 | +4,9 | 7,8 | 18/41 | 86,8 % | **10/51** |
| `mistral-small-latest` | 51 | −2,3 | 8,7 | 19/51 | 76,9 % | 0 |
| `zai-glm-5-3-flash`, `low` | 51 | −0,6 | 8,8 | 23/51 | 79,7 % | 0 |

### 5.3 Évaluation CECRL, écart à 2512 (score composite, 0 à 100)

| Candidat | Sessions | Écart moyen | Écart moyen en valeur absolue | Même niveau |
|---|---|---|---|---|
| **2512, second passage (bruit)** | 10 | +0,8 | **1,8** | 4/10 |
| Large 4 `low` | 8 (+2 échecs) | +7,1 | 8,6 | 2/8 |
| `mistral-small-latest` | 10 | −5,9 | 7,9 | 2/10 |
| `zai-glm-5-3-flash` `low` | 10 | +1,9 | **3,1** | **6/10** |

**Le critère « même niveau » est bruité :** beaucoup de sessions sont juste à la limite entre deux niveaux, si bien que 2512 lui-même ne retrouve le même niveau que 4 fois sur 10. Il vaut mieux juger sur l'écart de score.

Écarts notables :

- **Large 4 :** es `ddce0954` passe de 44 (A1) à 72 (B2), fr `028e9785` de 54 (A2) à 70 (B2).
- **Small :** en `02b321ac` passe de 77 (B2+) à 56 (A2+), en `a87c7133` de 90 (C2) à 76 (B2+).
- **GLM Flash :** son plus grand écart est de 7 points (de `fffb8fad` 47 A1+ à 54 A2). Toutes les autres sessions restent à 6 points ou moins de 2512.

### 5.4 Temps de réponse, tokens et coût

| Candidat | Appel | Temps médian / p90 (s) | Tokens générés (dont raisonnement) | $ par appel |
|---|---|---|---|---|
| 2512 | juge | 2,6 / 6,1 | 281 (0) | 0,0011 |
| 2512 | CECRL | 8,9 / 12 | 515 (0) | 0,0032 |
| Large 4 `low` | juge | **176 / 266** | 4 923 (4 748) | 0,0112 |
| Large 4 `low` | CECRL | **234 / 301** | 3 594 (3 309) | 0,0102 |
| small | juge | 1,6 / 3,0 | 256 (0) | 0,0004 |
| small | CECRL | 3,4 / 5,7 | 441 (0) | 0,0010 |
| GLM Flash `low` | juge | 2,8 / 5,8 | 375 (107) | 0,0004 |
| GLM Flash `low` | CECRL | 5,1 / 11,2 | 584 (118) | 0,0010 |

Avec Large 4 `low`, **56 appels sur 61 auraient dépassé les budgets de tokens de la prod**, et 7 ont été tronqués malgré la marge supplémentaire. Avec GLM Flash `low`, aucun appel sur 61 ne les aurait dépassés et aucun n'a échoué.

**Mesures rapides sur un prompt minuscule** (la même phrase d'apprenant fautive) :

- Large 4 refuse `reasoning_effort: "none"` (valeurs acceptées : `low`, `medium`, `high`).
- GLM Flash refuse aussi `none` (valeurs acceptées : `low`, `high`, `max`). En `low`, il ne génère que 21 tokens de raisonnement et répond en 1,7 s.

### 5.5 Rapports bruts

- `sim-runs/judge-model-replay-2026-11-16T16-05.md` : 2512 ×2 contre Large 4 `low`.
- `sim-runs/judge-model-replay-small-2026-11-16T15-57.md` : 2512 contre small.
- `sim-runs/judge-model-replay-glm-flash-low-2026-11-16T16-17.md` : 2512 contre GLM Flash `low`.

---

## 6. Lecture des résultats

1. **2512 est stable** : 2 points d'écart en prononciation et 2 points en évaluation CECRL d'un passage à l'autre. Un candidat doit rester proche de ce niveau pour pouvoir le remplacer sans recalibrage.
2. **Large 4 `low` est écarté.** Il met 3 à 4 minutes par appel, échoue sur 1 appel sur 5, note plus haut (+5 en prononciation, +7 en évaluation CECRL) avec de grands sauts, et coûte environ 10 fois plus cher par appel.
3. **Small n'est pas un remplaçant direct.** Il est rapide, fiable et 3 fois moins cher, mais il s'écarte de 8 à 9 points en prononciation dans les deux sens, et il est plus sévère en évaluation CECRL de façon irrégulière (jusqu'à −21 points). Un simple décalage ne suffirait pas à le recalibrer.
4. **GLM 5.3 Flash `low` a des résultats contrastés selon la tâche.**
   - **Évaluation CECRL : c'est le meilleur candidat**, et de loin. Il est à 3,1 points de 2512 en moyenne, avec un léger biais à la hausse (+1,9), et retrouve le même niveau sur 6 sessions sur 10, mieux que les 4 sur 10 de 2512 contre lui-même. Il est rapide (5 s), fiable (0 échec), environ 3 fois moins cher et dispose d'un quota de 333 requêtes par minute.
   - **Juge de prononciation : il n'est pas meilleur que small.** Il n'a pas de biais (−0,6), mais s'écarte en moyenne de 8,8 points, avec 23 tours sur 51 à plus de 5 points et 80 % des mots avec le même verdict, contre un bruit de 2,1 points et 96 % pour 2512. Les moyennes par session restent assez proches (à 7 points ou moins), mais la note tour par tour n'est pas fidèle.
   - **Avant d'adopter GLM pour l'évaluation CECRL :**
     - confirmer le prix réel facturé par Mistral ;
     - mesurer sa propre stabilité (un second passage GLM) ;
     - élargir l'échantillon, en particulier aux niveaux B1 à C1 et à l'italien.
5. **Pour le juge de prononciation, aucun candidat testé ne remplace 2512** sans recalibrage.
6. **Le correctif immédiat du 429 ne passe pas forcément par un changement de modèle.** Deux options :
   - demander à Mistral d'augmenter le quota de `mistral-large-2512` (onglet Limits de la console) ;
   - faire attendre `postWithRetry()` jusqu'à la fenêtre suivante en cas de 429, et étaler les appels au juge dans `assess-all`.

## 7. Points à vérifier par un relecteur

- **Fidélité du rejeu :** `scripts/judge-model-replay.ts` reproduit-il fidèlement les chemins de prod ? Comparer `judgeTurn()` / `cefrSession()` avec `judge()` dans `azure-ensemble.ts` et avec `app/api/evaluate/route.ts`.
- **Neutralité du refactor :** le refactor de `azure-ensemble.ts` ne change-t-il pas le comportement ? Voir `git diff` sur ce fichier.
- **Taille de l'échantillon :** 10 sessions, dont beaucoup de niveau A1 en es/de. L'italien est absent et les niveaux C sont peu nombreux.
- **Contexte de prod :** les variables d'environnement et le compte Mistral de la prod sont-ils les mêmes qu'en local ?

---

## 8. Suite du 17 novembre : justesse plutôt que proximité avec 2512

Les tests du 16 mesuraient l'écart **à 2512**. Or être proche de 2512 ne dit pas si la note est **juste**. Le 17, on a donc mesuré les juges contre les **références de calibration** : la note de prononciation Speechace, ainsi que les niveaux oral et global d'ELAO, sur les sessions `source='speechace'` marquées `speechace_scores.reference.calibration = true`.

### 8.1 Transcription : Voxtral n'invente plus

`scripts/stt-fidelity-replay.ts` compare plusieurs moteurs de transcription à la transcription Speechace :
- les modèles Mistral `voxtral-mini-latest`, `voxtral-mini-transcribe-3` et `voxtral-small-transcribe-3` ;
- Gradium ;
- Deepgram.

Résultats :
- Les modèles de transcription Mistral n'inventent quasiment rien : moins de 2 % de mots « non entendus ».
- `voxtral-small-transcribe-3` est le meilleur (environ 8,5 % de taux d'erreur de mots, WER).
- La température 0 ne change rien.
- Gradium fait moins bien.

Le problème d'invention qui avait fait retirer Voxtral le 9 septembre concernait la **notation directe** par Voxtral (chat audio), pas son endpoint de transcription.

### 8.2 Juges audio (multimodaux)

`scripts/audio-judge-replay.ts` passe par OpenRouter, avec ZDR et sans entraînement par défaut. Qwen a été accepté avec rétention pour ce test uniquement.

Résultats :
- Le prompt « transcription + audio » fait mieux que l'audio seul.
- Gemini et Qwen séparent mieux les niveaux qu'`azure-ensemble`, qui surnote les A1 (environ 73, contre 51 chez Speechace).
- Aucun n'a été retenu à ce stade : la piste choisie est de garder la transcription (Voxtral) et un juge texte avec Azure (8.1, 8.3). Les adopter supposerait aussi d'envoyer l'audio des candidats à ces fournisseurs, ce qui reste à décider.

### 8.3 Juge texte contre les références : `scripts/judge-calibration-replay.ts`

**Principe du script :**
- Mêmes preuves pour chaque juge : transcription Voxtral et notes acoustiques Azure.
- Même `JUDGE_SYSTEM` et même `scoreFromVerdict` qu'en prod.
- La note « prod en base » est le résultat `azure-ensemble` déjà stocké dans `session_turn_evaluations` ; elle ne coûte aucun appel.
- Les preuves sont mises en cache dans `sim-runs/judge-evidence-cache.jsonl`.
- Le script se reprend avec `--resume`.

**Incident Azure.** La ressource Azure Speech `bdspeechapi` était en **F0 (gratuit)** et renvoyait « Quota exceeded » sur les vraies réponses. Elle est passée en **S0** le 17. Tant qu'elle était en F0, la prod pouvait elle aussi noter sans Azure, sans erreur visible : le juge reçoit alors « ACOUSTIC scores: unavailable ».

**12 sessions, 60 tours :**

| Juge | r Speechace | ρ niveau oral | Moyenne A1 | Écart C−A |
|---|---|---|---|---|
| Speechace (référence) | — | 0,84 | 51 | 27 |
| Prod en base (2512 + Azure) | 0,70 | 0,71 | 73 | 15 |
| 2512 sans Azure | 0,80 | 0,85 | 79 | 12 |
| Small 4 sans Azure | 0,64 | 0,74 | 77 | 14 |
| Small 4 + Azure | 0,83 | 0,80 | 71 | 13 |
| 2512 + Azure (preuves du jour) | 0,36 | 0,62 | 79 | 8 |

Sans Azure, 2512 note environ 8 points plus haut. **Azure tire donc les notes vers le bas : il est utile.**

**30 sessions, 149 tours :**

| Juge | r Speechace | ρ Speechace | ρ niveau oral | Moyenne A1 | Écart C−A |
|---|---|---|---|---|---|
| Speechace (référence) | — | — | 0,85 | 56 | 30 |
| Prod en base (2512 + Azure) | 0,61 | 0,60 | 0,51 | 76 | 15 |
| Small 4 + Azure | 0,47 | 0,54 | 0,70 | 72 | 15 |
| Azure seul | 0,63 | 0,72 | 0,63 | 82 | 9 |

→ **Small 4 et 2512 sont à égalité** : les écarts restent dans le bruit à cette taille d'échantillon. L'avantage de Small 4 vu sur 12 sessions n'est pas confirmé.

Rapports :
- `sim-runs/judge-calibration-2026-11-17T09-18.md` (12 sessions) ;
- `sim-runs/judge-calibration-2026-11-17T09-41.md` (30 sessions).

### 8.4 Décision : juge de prononciation sur Small 4 (déployé le 17)

- `mistralPronunciationModel()` renvoie désormais `mistral-small-2603` (Small 4, version figée) : voir `MISTRAL_PRONUNCIATION_JUDGE_MODEL` dans `lib/mistral.ts`.
- Il ne se rabat plus sur `MISTRAL_MODEL`.
- Retour arrière : `MISTRAL_PRONUNCIATION_MODEL=mistral-large-2512`.
- **Raison :** même qualité, et 100 requêtes par minute au lieu de 15. Le 429 des imports Speechace venait du juge.
- L'évaluation CECRL reste sur 2512.

### 8.5 Réévaluation des 150 sessions de calibration (prompt v10, juge Small 4)

Commande : `npx tsx scripts/calibration-set.ts score --rescore-pronunciation --eval-interval 40`.
- `--rescore-pronunciation` relance le juge même si la session a déjà une note.
- `--eval-interval` espace les évaluations pour laisser du quota 2512 à la prod.

Rapport : `analysis/reports/calibration-v10-2026-11-17T15-21.md` (le dossier est ignoré par git ; on le régénère avec `npm run analysis:calibration`).

**Prononciation contre Speechace, avant (v8, ancien juge) → après (Small 4) :**

| Mesure | Avant | Après |
|---|---|---|
| r Speechace | 0,60 | 0,65 |
| ρ niveau oral | 0,55 | 0,63 |
| ρ niveau global | 0,26 | 0,35 |
| Écart C−A | 11 | 13,5 |

**Niveau final, v8 → v10 :**

| Référence | À un niveau près | Biais en v10 |
|---|---|---|
| Niveau global | 85 % → 83 % | +0,05 |
| Niveau oral | 85 % → **79 %** | **+0,67** |

- La surnotation des oraux A1–A2 vient de l'évaluateur (prompt v10), pas de la prononciation.
- Sur 25 oraux A1, 13 sont notés B1.

**Corrections d'échelle** (`analysis/scenarios.ts`) :
- `pron-stretch` et `pron-linear` font gagner le niveau oral (83 %) mais perdre le niveau global (75–78 %).
- `pron-lift-1` gagne 2 points à l'oral (81 %) sans perte au global.
- Les autres ne changent rien.

**Aucune correction n'est retenue.** La question ouverte est d'ordre produit : quelle référence suivre, le niveau oral Speechace (surtout acoustique) ou le niveau global ELAO ?
