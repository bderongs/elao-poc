# Audit du prompt de l'examinatrice (Léa) — 2026-11-17

Ce document couvre le prompt qui fait parler Léa pendant le test : [lib/conversation-prompts.ts](../lib/conversation-prompts.ts), assemblé tour par tour par [lib/examiner-prompt.ts](../lib/examiner-prompt.ts). Il est appelé depuis [app/api/chat/route.ts](../app/api/chat/route.ts) et rattrapé si besoin par [lib/examiner-guard.ts](../lib/examiner-guard.ts).

Le prompt d'évaluation finale (`lib/cefr-prompt.ts`) n'entre pas dans cet audit.

## En bref

- **Le problème.** Quand le code impose une question (banques C1/C2 et A1), Léa ne la pose qu'environ **une fois sur deux** : 11 ou 12 fois sur 20, avec `mistral-small` comme avec `mistral-large`, le modèle de prod. Le reste du temps, elle rebondit sur la dernière réponse du candidat.
- **Ce n'est pas d'abord une question de modèle.** Le prompt contient des règles qui demandent l'inverse de la consigne du tour, et la consigne arrive avant tout l'historique de la conversation.
- **Le correctif mesuré.** Placer la consigne du tour juste après le dernier message du candidat, au lieu de la laisser dans le prompt système, donne **20 questions posées sur 20, sur les deux modèles**, sans fuite de la consigne et sans double question.
- **La proposition.** Restructurer le prompt en trois couches :
  1. un socle court et stable ;
  2. les règles du type de tour, et seulement celles-là ;
  3. la consigne du tour, placée en dernier.

  Les règles qui se contredisent disparaissent, et avec elles les phrases « this overrides… ».

## 1. Comment le prompt fonctionne aujourd'hui

À chaque réponse du candidat, le serveur envoie au modèle :

1. **Un prompt système reconstruit pour ce tour.** Il fait 8 400 à 9 300 caractères en anglais et contient :
   - la persona et l'ouverture, dans la langue du test ;
   - environ 25 règles générales ;
   - l'échelle CECRL complète ;
   - la règle de relance ;
   - la règle de variété des sujets ;
   - la règle de fin ;
   - à la fin, la partie propre au tour : une sélection de la banque (A2–B2), une question imposée (A1, C1, C2), une relance imposée, ou une note interne (changement de sujet, incompréhension, abandon de la question).
2. **Tout l'historique de la conversation**, puis la dernière réponse du candidat.
3. **Une vérification après coup** ([examiner-guard.ts](../lib/examiner-guard.ts)). S'il n'y a pas de question, ou si c'est la même que la précédente, le modèle est rappelé une fois.
4. **Le cas des questions client (profil Safran)** : le code écrit la réponse, sans appel au modèle.

Le texte a grossi par ajouts successifs (28 commits sur ce fichier). Chaque comportement gênant a reçu sa règle, souvent avec ses exemples et son historique.

### Mesures par type de tour

Prompts assemblés en anglais :

| Type de tour | Taille | Formulations négatives (never, not, do NOT…) | Ouverture incluse | Règle de fin incluse |
|---|---|---|---|---|
| B1, question libre | 8 583 car. | 39 | oui | oui |
| C1, question imposée | 8 494 car. | 42 | oui | oui |
| A1, question imposée | 8 474 car. | 36 | oui | oui |
| B1, changement de sujet | 9 217 car. | 44 | oui | oui |
| B1, incompréhension | 9 282 car. | 45 | oui | oui |

La taille n'est pas excessive (environ 2 000 tokens). Le problème vient de ce que le texte contient, et de l'endroit où arrive la consigne.

## 2. Constats

### 2.1 Des règles qui demandent le contraire de la consigne du tour

Ces règles sont envoyées à chaque tour, quel que soit son type :

| Règle (toujours envoyée) | Ce qu'elle demande | Tour où elle contredit la consigne |
|---|---|---|
| REALISM AND TOPIC BREADTH | « dig into what they said with ONE targeted follow-up question rather than firing an unrelated bank question » | Chaque question imposée (C1/C2/A1) : c'est exactement ce qu'on lui demande de faire. |
| SHORT ANSWER RULE | relancer une réponse courte avant de changer de sujet | Question imposée, changement de sujet forcé |
| OUVERTURE | « End with ONE simple, everyday warm-up question » | **Tous les tours après le premier.** Le code le reconnaît en commentaire (« the OPENING section is still in every turn's prompt ») |
| Avoid yes/no questions | éviter les questions fermées | A1 et incompréhension, où le fermé est voulu |
| « Les questions de la banque sont déjà rédigées… utilise-les telles qu'elles sont » | concerne la sélection A2–B2 | Envoyée même quand il n'y a pas de banque, ou pour une question imposée qu'il faut poser telle quelle |
| TARGET RUNG… « Ask your next question at this difficulty » | inventer une question au niveau visé | Relance imposée, question imposée |

Pour contrer ces conflits, les consignes de tour ont dû ajouter des priorités explicites. Exemples :
- « This turn is NOT a follow-up turn: it overrides the SHORT ANSWER RULE and the follow-up advice above » ;
- « right now being understood matters more than the "avoid yes/no questions" rule above » ;
- côté profil client : « It takes precedence over every other rule above that it seems to break ».

Le modèle doit arbitrer entre une exception écrite une fois et une règle générale répétée et illustrée. Il suit souvent la règle générale.

### 2.2 La consigne du tour arrive avant l'historique

La partie propre au tour est bien en fin de prompt système. Mais le modèle lit ensuite toute la conversation, où Léa a presque toujours rebondi sur la réponse précédente. Au moment d'écrire, ce qu'il a lu en dernier, c'est la réponse du candidat, pas la consigne. Il prolonge donc le schéma de l'historique.

### 2.3 Des parties envoyées à chaque tour, utiles seulement à un tour

- L'ouverture (intro, durée, question de mise en route) : utile au premier tour seulement.
- La règle de fin (`__END__`) : utile au dernier tour seulement. Le code sait déjà quand c'est la fin.
- L'échelle complète des six niveaux, avec l'explication du processus qui évalue chaque réponse : le modèle n'a besoin que de la description du niveau visé. Et aux niveaux où le code choisit la question, il n'en a pas besoin du tout.
- La consigne générale d'incompréhension (COMPREHENSION) fait doublon avec la note ciblée que le code ajoute quand il détecte l'incompréhension, et leurs détails diffèrent.

### 2.4 Des répétitions et des listes d'interdits

- La langue est rappelée trois fois (LANGUAGE en tête, « Never output words from a language other than… », la ligne finale propre à chaque langue).
- La règle des mots de transition tient un long paragraphe, plus une liste de 21 interjections interdites, plus « jamais deux fois la même ». Le code sait déjà choisir ce mot lui-même (il le fait pour les questions client).
- Le prompt contient 36 à 45 formulations négatives. Les petits modèles suivent mieux une description de ce qu'il faut faire qu'une liste de choses à éviter.

### 2.5 Ce qui est bien fait et à garder

- **Le choix des questions par le code** (A1, C1, C2, mise en route, questions client) : c'est la bonne direction, il faut aller au bout.
- **Le suivi des sujets et le changement forcé**, calculés hors du modèle.
- **La vérification après coup** (pas de question, question répétée).
- **Les listes de mots de transition prêtes à l'emploi dans chaque langue**, au lieu de traductions faites à la volée.
- **Le simulateur** ([lib/conversation-sim.ts](../lib/conversation-sim.ts)), qui utilise exactement le même prompt que le vrai test.

## 3. Mesure

**Méthode.** Script de rejeu (voir la section 5). Points de départ : 10 vraies sessions récentes en base, 5 en anglais et 5 en français, coupées à deux moments différents, soit 20 contextes. À chaque contexte, le code impose une question C1 tirée de la banque, et on compare deux placements de la même consigne :

- **actuel** : la consigne est dans le prompt système, comme aujourd'hui ;
- **à la fin** : la même consigne, mot pour mot, retirée du prompt système et placée après la dernière réponse du candidat, comme note interne.

Une question compte comme « posée » si au moins 60 % de ses mots sont dans la réponse.

| Modèle | Placement | Question posée | Mot pour mot |
|---|---|---|---|
| mistral-small-latest | actuel | 11 / 20 | 11 / 20 |
| mistral-small-latest | **à la fin** | **20 / 20** | 18 / 20 |
| mistral-large-2512 (prod) | actuel | 12 / 20 | 11 / 20 |
| mistral-large-2512 (prod) | **à la fin** | **20 / 20** | 12 / 20* |

\* Les écarts restants sont typographiques : apostrophe courbe, minuscule après « Moving on, ».

**Ce qu'on voit dans les réponses ratées (placement actuel).** Léa enchaîne sur la dernière réponse au lieu de poser la question prévue :
- « Qu'est-ce qui vous plaît le plus dans ce métier ? »
- « Vous avez des frères et sœurs ? », à un candidat en C1.

Il y a aussi un cas de double question avec une parenthèse : « (Et sinon, y a-t-il…) ».

**Effets secondaires du placement à la fin :**
- aucune fuite de la note interne et aucune double question sur les 40 réponses ;
- en revanche, les mots de transition deviennent répétitifs : avec `mistral-large`, « Moving on » / « Autre chose : » ouvrent 19 réponses sur 20. C'est à corriger dans la refonte (voir la section 4, point 4).

**Limites de la mesure.**
- Elle couvre 20 contextes, uniquement des tours C1 « question imposée », en anglais et en français.
- Les tours libres (A2–B2), les relances et les changements de sujet n'ont pas été mesurés.
- L'API Mistral limitait le débit pendant le test (clé partagée avec l'autre session), d'où un échantillon modeste.

Le résultat est assez net pour décider. Il faudra le confirmer sur une matrice plus large avant la mise en prod.

## 4. Proposition

### Principe : trois couches, chacune à sa place

1. **Le socle** : dans le prompt système, identique à chaque tour, environ 2 500 caractères visés.
   - Qui est Léa, son but (faire parler le candidat), le ton direct et neutre, le vouvoiement.
   - La langue (une seule fois), la forme orale (pas de markdown, 1 ou 2 phrases, une seule question).
   - Les interdits de fond qui valent partout, formulés positivement :
     - pas de reformulation de la réponse ;
     - pas de compliment ;
     - pas de correction directe ;
     - pas de jeu de rôle ni de débat ;
     - pas de question de connaissances.
2. **Les règles du type de tour** : dans le prompt système, choisies par le code. Une seule variante est envoyée par tour :
   - *ouverture* : intro, durée, question de mise en route ;
   - *libre (A2–B2)* : la description du niveau visé, la sélection de la banque, la règle de relance, la règle de variété des sujets ;
   - *question imposée* : poser la question donnée, sans relance ;
   - *relance imposée* : la ou les relances prévues ;
   - *incompréhension* et *abandon* : comme aujourd'hui, sans la règle générale en doublon ;
   - *clôture* : la phrase de fin seulement.

   Chaque variante ne contient que des règles compatibles entre elles. Les « this overrides… » deviennent inutiles et disparaissent.
3. **La consigne du tour** : placée après la dernière réponse du candidat, comme note interne. Elle contient la question à poser, ou « change de sujet vers X », ou « reformule plus simplement ». C'est le changement mesuré dans la section 3.

### Ce que le code peut reprendre au modèle

- **Le mot de transition.** Il est déjà choisi par le code pour les questions client. L'étendre aux questions imposées règle à la fois la répétition observée en section 3 et la longue règle des mots autorisés et interdits.
- **Pour les questions imposées, la question elle-même**, comme pour Safran : le modèle n'écrirait plus rien sur ces tours. C'est le plus fiable, mais Léa ne pourrait plus ajuster quelques mots pour faire le lien avec la réponse précédente. Avec le placement à la fin, c'est probablement inutile, à confirmer par la mesure.

### Ordre de travail proposé

| Étape | Contenu | Dépend du choix du modèle ? |
|---|---|---|
| 1 | Placer la consigne du tour après la dernière réponse du candidat, et non plus dans le prompt système. Changement petit, mesuré sur les deux modèles. | Non : gain de 11–12/20 à 20/20 sur les deux. |
| 2 | Faire de ce rejeu un script du dépôt (`scripts/examiner-adherence-replay.ts`), étendu aux relances, aux changements de sujet et aux tours libres. | Non |
| 3 | Découper le prompt en socle + variantes par type de tour : retirer l'ouverture et la règle de fin des autres tours, supprimer les règles en conflit et les doublons. | Oui : à mesurer sur le modèle retenu |
| 4 | Faire choisir le mot de transition par le code, pour corriger la répétition. | Non |
| 5 | Validation : matrice de simulations (`scripts/sim-matrix.ts`) avant et après, sur le respect des questions, le niveau, la variété des sujets, la longueur des questions et la langue ; puis quelques vrais tests. | Oui |

**Coordination avec la session sur le choix du modèle.**
- Les étapes 1, 2 et 4 peuvent se faire tout de suite : le gain ne dépend pas du modèle.
- L'étape 3 change le comportement général de Léa. Pour savoir ce qui vient du prompt et ce qui vient du modèle, il vaut mieux la mesurer une fois le modèle choisi.

### Risques

- **Tours libres A2–B2.** Avec moins de règles, le modèle a plus de liberté. Il faut vérifier par simulation qu'il ne retombe pas dans ce que ces règles corrigeaient : reformulation de la réponse, rester trop longtemps sur un sujet, « Great! ».
- **Rien de nouveau à ajouter.** Chaque règle supprimée correspond à un problème déjà observé. La refonte doit garder le comportement, pas le texte. C'est pourquoi la mesure avant/après est indispensable.
- **Les sept langues.** La persona et l'ouverture sont rédigées dans chaque langue ; le socle ne doit pas les perdre. Il faut tester au moins en, fr et nl.

## 5. Mise en œuvre (2026-11-17)

Les cinq étapes ont été faites le même jour : le choix du modèle de conversation n'était plus en attente.

### Ce qui a changé dans le code

- **[lib/conversation-prompts.ts](../lib/conversation-prompts.ts)** : `buildTurnPrompt(language, rung, spec)` renvoie `{ system, turnNote }`.
  - Le prompt système contient la persona, le socle (`buildCore`) et les règles du type de tour (`buildTurnKindRules`), plus le rappel de langue.
  - `turnNote` est la consigne du tour, écrite par `buildTurnNote`.
  - L'ouverture n'est plus envoyée qu'au premier tour.
  - La règle de fin n'est plus envoyée qu'au dernier tour, sous forme de note.
  - L'échelle complète des niveaux est supprimée : seule la description du niveau visé reste, et seulement pour les tours libres.
  - La note « MASTERY-ZONE PACING » est supprimée : le modèle ne voit pas les silences, c'est le code qui détecte l'incompréhension.
- **[lib/examiner-prompt.ts](../lib/examiner-prompt.ts)** décrit chaque tour par un `TurnSpec` : `opening`, `closing`, `free`, `ask`, `followUp` ou `clarify`.
  - Les mots d'ouverture des questions imposées sont choisis par le code (`pickOpener`) : un mot de transition, ou, au-dessus de A2, une phrase de changement de sujet une fois sur deux. Ce n'est jamais celui qui ouvrait la réponse précédente.
  - Le nouveau paramètre `previousReply` sert à ce choix.
- **[app/api/chat/route.ts](../app/api/chat/route.ts)** et **[lib/conversation-sim.ts](../lib/conversation-sim.ts)** : la consigne est ajoutée au dernier message du candidat (`withTurnNote`).
  - L'historique gardé côté navigateur ne contient pas les consignes.
  - Au dernier tour, `__END__` est remplacé par la note de clôture.
- **[lib/session-cost.ts](../lib/session-cost.ts)** : l'estimation de coût compte aussi la consigne.
- **[scripts/examiner-adherence-replay.ts](../scripts/examiner-adherence-replay.ts)** : le script de mesure de la section 3, étendu à cinq types de tours et à des tirages reproductibles.

**Taille du prompt.** Le prompt système passe de 8 400–9 300 caractères à 2 000 caractères (questions imposées, incompréhension, clôture) ou 3 300 caractères (tours libres, avec la sélection de la banque). La consigne ajoute 100 à 500 caractères.

### Résultats avant / après

Mesure faite avec `scripts/examiner-adherence-replay.ts` :
- 6 vraies sessions (3 en anglais, 3 en français), coupées à 2 moments, soit 12 contextes par type de tour ;
- les mêmes tirages avant et après le changement.

| Type de tour | mistral-small-latest, avant → après | mistral-large-2512, avant → après |
|---|---|---|
| Question C1 imposée, posée | 2/12 → **12/12** | 7/12 → **11/12**¹ |
| Question A1 imposée, posée | 3/12 → **12/12** | 6/12 → **12/12** |
| Changement de sujet vers le domaine demandé | 8/12 → **12/12** | 8/12 → **11/12**² |
| « Pas compris » : même question, plus simple | 4/12 → 7/12³ | 3/12 → 7/12³ |
| Double question, résumé de la réponse, compliment, fuite de la consigne | 0 → 0 | 1 → 0 |

1. Le seul cas compté raté est en fait une reformulation fidèle (« something you've improved at as you've gotten older »).
2. Le cas compté raté est une erreur du classifieur de sujets : la question porte bien sur le lieu de vie demandé.
3. Ce critère est grossier : la question doit être plus courte et ne pas reprendre les mêmes mots. Les cas comptés ratés sont presque tous des questions simplifiées en choix fermé, ce qui est permis. Le scénario est aussi artificiel : dans les sessions rejouées, le candidat avait en réalité compris.

Les mots d'ouverture des questions imposées sont maintenant variés : 8 à 10 différents sur 12 réponses, contre « Moving on » / « Autre chose : » dans 19 réponses sur 20 lors du premier essai.

### Reste à surveiller en vrai

- Les tours libres (A2–B2) ont moins de règles qu'avant. Sur ces rejeux, pas de rechute (résumé, compliment, double question), mais seule une série de vraies sessions le confirmera.
- La longueur des réponses sur les questions C1 imposées monte à environ 22 mots. Ce sont les questions de la banque, désormais réellement posées, au lieu de questions plus courtes inventées par Léa.

### Simulations complètes

Matrice `scripts/sim-matrix.ts` : en, fr et nl-BE, apprenants A2, B1 et C1 simulés, 1 session par case, `mistral-small-latest`. Dossier `sim-runs/matrix-2026-11-17T16-43-41`.

- **Conduite de l'entretien**, notée de 1 à 5 par un juge LLM : 8 cases sur 9 sont ✅. En anglais, A2 passe de 3,7 à 4,4 et B1 de 3,8 à 4,6 par rapport à la matrice du 12 octobre. fr B1 reste à 3,8, comme en octobre ; le point faible est le même : le niveau visé monte trop vite.
- **Niveau final** : il reste surestimé de 2 à 3 demi-niveaux en B1 et C1, comme en octobre (fr B1 à +3, en B1 à +2,7). Ce problème vient de l'estimation du niveau tour par tour et de l'évaluation finale, ou d'un apprenant simulé trop fluide, pas du prompt de Léa. C'est hors du champ de cet audit.
