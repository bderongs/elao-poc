# Module d'expression orale — spécification détaillée · Anglais

Entretien avec agent conversationnel, environ 5 minutes. Sortie : niveau CECRL au quart de niveau de A1.1 à C1.4, C2 étant une bande terminale sans sous-niveau.

---

## 0. Principe et répartition des rôles

L'évaluation se déroule en deux temps strictement séparés : les faits sont d'abord établis, le niveau est calculé ensuite. Aucune des sources de constat ne prononce de niveau.

| Étape | Exécutant | Produit | Nature |
|---|---|---|---|
| A — Conduite de l'entretien | Modèle de langue | Corpus de parole du candidat | Élicitation |
| B — Transcription | Deepgram Nova-3 | Texte, horodatage et confiance au mot | Mesure |
| C — Métriques temporelles | Code | Débit, pauses, MLR, latences de tour | Mesure |
| D — Analyse acoustique | Azure Pronunciation Assessment | Scores mot, syllabe, phonème | Mesure |
| E — Détection croisée | Code | Signalements de masquage | Contrôle |
| F — Relevé lexico-grammatical et interactionnel | Mistral | Faits cités avec horodatage | Constat |
| G — Notation | Mistral | Bandes des 5 critères jugés | Jugement |
| H — Agrégation | Code | Bandes mesurées, portes, plafonds, quart | Calcul |
| I — Validation | Réviseur certifié | Niveau validé ou corrigé | Contrôle humain |

Deux critères sur sept ne sont jamais jugés par un modèle de langue : l'aisance et la prononciation sont mesurées puis converties par des seuils. C'est ce qui réduit la surface de jugement et rend le résultat reproductible.

---

## 1. Structure de l'entretien

Cinq phases de difficulté croissante. La progression est planifiée, non improvisée : c'est elle qui garantit qu'un candidat fort rencontre des tâches de niveau supérieur et qu'un candidat faible n'est pas mis en échec d'emblée.

| Phase | Durée | Tâche langagière | Niveaux discriminés |
|---|---|---|---|
| 1 — Ouverture | 30 s | Se présenter, répondre à des questions factuelles | A1 – A2 |
| 2 — Description | 60 s | Décrire une situation, une expérience, un environnement | A2 – B1 |
| 3 — Récit et explication | 75 s | Raconter un événement passé, expliquer un fonctionnement | B1 – B2 |
| 4 — Argumentation | 90 s | Prendre position, justifier, envisager une objection | B2 – C1 |
| 5 — Relance et réparation | 45 s | Répondre à une objection, nuancer, reformuler | C1 – C2 |

La phase 5 est celle qui rend le C2 attestable : elle place le candidat en situation de reprendre son propre propos sous contrainte, ce qu'un monologue ne permet pas.

**Règle d'arrêt anticipé.** Si le candidat ne produit aucune réponse exploitable sur deux phases consécutives, l'entretien s'achève après la phase en cours. Il n'y a pas d'intérêt à soumettre un candidat A1 à une tâche argumentative, et le corpus déjà recueilli suffit à la décision.

---

## 2. Étape A — Prompt de conduite de l'agent

C'est le prompt le plus sensible du dispositif : l'agent fait partie de l'instrument de mesure. Un modèle de langue s'aligne spontanément sur son interlocuteur — il simplifie face à un candidat faible, s'enrichit face à un candidat fort. Sans contrainte explicite, la difficulté réelle de l'épreuve varie avec le candidat et les niveaux cessent d'être comparables.

```
You are conducting a spoken English assessment interview. You are not a teacher,
not a tutor, and not an examiner who gives feedback. You are an interviewer whose
only job is to elicit speech.

## ABSOLUTE CONSTRAINTS

1. NEVER correct, rephrase, or comment on the candidate's language. Not once.
   Not even implicitly by repeating a corrected version of what they said.
2. NEVER simplify your own language to match a weak candidate, and never enrich
   it to match a strong one. Your register is FIXED, defined below, and identical
   for every candidate.
3. NEVER supply a word the candidate is searching for. If they hesitate or ask
   for a word, say "Take your time" and wait.
4. NEVER evaluate, praise, or express judgement. No "good", "excellent",
   "well done", "that's interesting". Acknowledge only with neutral markers:
   "I see.", "Right.", "Thank you."
5. NEVER speak for more than 25 words per turn. The candidate must hold the floor.
6. NEVER ask more than one question per turn.
7. If the candidate speaks a language other than English, say exactly once:
   "Please continue in English." Then proceed regardless of what they do.
8. NEVER discuss the assessment, the scoring, the level, or how they are doing,
   even if asked. Reply: "I'm not able to comment on that. Let's continue."

## YOUR FIXED REGISTER

Neutral, professional, standard English. Sentences of 8 to 20 words. Common
vocabulary only — no idioms, no phrasal verbs beyond the most frequent, no
low-frequency words. Present and past simple. One clause per sentence where
possible. This register never changes, whatever the candidate produces.

## PHASE SEQUENCE

You move through five phases in order. Move on when the phase duration is
reached, whatever the quality of what you received.

PHASE 1 — OPENING (30 seconds)
Fixed opening, word for word:
"Hello. Thank you for joining. Could you tell me your name and where you live?"
Then one follow-up from: what they do; how long they have done it; how they
travelled today.

PHASE 2 — DESCRIPTION (60 seconds)
Ask the candidate to describe something concrete. Use one of:
"Could you describe the place where you work or study?"
"Could you describe a typical day for you?"
"Could you describe the area where you live?"
One follow-up asking for a detail they mentioned: "You mentioned X. Could you
say more about that?"

PHASE 3 — NARRATIVE AND EXPLANATION (75 seconds)
Ask for a past event or a process. Use one of:
"Could you tell me about a time when something at work did not go as planned?"
"Could you explain how you learned to do your job?"
"Could you tell me about a change you have had to deal with recently?"
One follow-up asking for cause or consequence: "Why did that happen?" /
"What happened after that?"

PHASE 4 — ARGUMENTATION (90 seconds)
Ask for a position and its justification. Use one of:
"Some people think working from home makes teams less effective. What is your
view?"
"Should employers pay for their staff to learn languages? Why?"
"Is it better to specialise in one skill or to learn many? Why?"
One follow-up asking for support: "What makes you say that?"

PHASE 5 — CHALLENGE AND REPAIR (45 seconds)
Present a counter-position to what the candidate just said, neutrally and without
aggression. Template:
"Someone could argue the opposite: [restate a plausible counter-position in
under 20 words]. How would you respond to that?"
Then one final turn: "Is there anything you would add?"

## CLOSING

"Thank you. That is the end of the interview."
Say nothing further.

## SILENCE HANDLING

If the candidate says nothing for 8 seconds, say once: "Take your time."
If silence continues for 8 more seconds, move to the next question in the phase.
If a full phase produces no usable speech, note nothing and continue.
```

**Points de conception à retenir.** La règle des 25 mots par tour est ce qui garantit que le corpus recueilli est celui du candidat et non celui de l'agent. Le registre fixe est ce qui rend deux passations comparables. Et l'interdiction de fournir un mot recherché préserve le critère lexical : un agent serviable détruit la mesure qu'il est censé permettre.

---

## 3. Étape B — Transcription

| Paramètre | Valeur | Raison |
|---|---|---|
| Modèle | Nova-3 | Couverture des sept langues du projet |
| Langue | `en` forcée | Jamais de détection automatique : un candidat faible produit des segments que la détection bascule vers sa L1 |
| Horodatage | Au mot | Toute l'étape C en dépend |
| Confiance | Au mot | Condition de la règle d'exclusion et de l'étape E |
| Keyterm Prompting | Lexique attendu des consignes, jusqu'à 100 termes | Évite que des mots corrects mais accentués soient transcrits de travers puis comptés comme impropriétés |
| Mots de remplissage | Détection activée | Les hésitations remplies sont des données de fluidité, pas du bruit |
| Diarisation | Activée | Sépare la parole de l'agent de celle du candidat |

**Règle d'exclusion.** Tout segment dont la confiance est inférieure à 0,6 est marqué. Un segment marqué ne peut produire aucun fait d'erreur grammaticale ou lexicale à l'étape F. Il peut en revanche produire un fait d'intelligibilité, où c'est précisément l'information recherchée.

**Séparation des tours.** Seuls les segments attribués au candidat entrent dans les étapes C, D et F. Les segments de l'agent servent uniquement au calcul des latences de tour.

---

## 4. Étape C — Métriques temporelles

```python
def metriques_orales(mots_candidat, tours_agent, tours_candidat):
    pauses = [mots_candidat[i+1]["debut"] - mots_candidat[i]["fin"]
              for i in range(len(mots_candidat)-1)]
    temps_pause = sum(p for p in pauses if p >= 0.25)
    duree = mots_candidat[-1]["fin"] - mots_candidat[0]["debut"]
    parole_effective = duree - temps_pause

    seq, sequences = 1, []
    for p in pauses:
        if p >= 0.50:
            sequences.append(seq); seq = 1
        else:
            seq += 1
    sequences.append(seq)

    latences = [c["debut"] - a["fin"] for a, c in zip(tours_agent, tours_candidat)]

    return {
        "parole_effective": parole_effective,
        "ratio_parole_candidat": parole_effective / duree_totale_entretien,
        "ratio_pause": temps_pause / duree,
        "debit_articulation": len(mots_candidat) / parole_effective * 60,
        "MLR": sum(sequences) / len(sequences),
        "pauses_1s": sum(1 for p in pauses if p >= 1.0),
        "latence_mediane": sorted(latences)[len(latences)//2],
        "latences_sup_3s": sum(1 for l in latences if l > 3.0),
    }
```

**Seuils de départ pour l'anglais**, à recalibrer sur étalons :

| Indicateur | A1 | A2 | B1 | B2 | C1 |
|---|---|---|---|---|---|
| MLR (mots par séquence) | ≤ 2 | 3 – 4 | 5 – 6 | 7 – 9 | ≥ 10 |
| Débit d'articulation (mots/min) | < 70 | 70 – 100 | 100 – 130 | 130 – 160 | ≥ 160 |
| Ratio de pause | > 0,50 | 0,40 – 0,50 | 0,30 – 0,40 | 0,20 – 0,30 | < 0,20 |
| Latence médiane de prise de tour | > 3 s | 2 – 3 s | 1,5 – 2 s | 1 – 1,5 s | < 1 s |

**Deux avertissements.** Ces valeurs sont indicatives et propres à l'anglais : le débit en mots par minute n'est pas transposable à l'espagnol ou à l'allemand, dont la longueur moyenne des mots et la structure rythmique diffèrent. Sept jeux de seuils sont nécessaires. Et la longueur moyenne des séquences ininterrompues reste le meilleur prédicteur isolé, meilleur que le débit brut, qui confond aisance et tempérament.

**La latence de prise de tour est propre au format conversationnel.** Elle n'existait pas en monologue et discrimine bien : elle mesure le temps de planification sous contrainte interactionnelle, ce qu'aucun autre indicateur ne capte.

**Détection de récitation.** Ratio de pause anormalement bas, aucune pause remplie, aucune auto-correction, MLR très régulière : signalement pour revue humaine, sans conclusion automatique.

---

## 5. Étape D — Analyse acoustique

**Mode.** Évaluation *scripted*, la transcription Deepgram servant de texte de référence. C'est le schéma recommandé lorsqu'on dispose d'un moteur de transcription distinct.

**Locale.** `en-GB`, `en-US` ou `en-AU`, selon la variété déclarée par le candidat avant la passation. Le choix de locale est un choix de norme phonémique ; il ne doit jamais être un défaut implicite.

**Scores exploités :** AccuracyScore au mot, au syllabe et au phonème, FluencyScore. Le CompletenessScore est inexploitable en mode *scripted* et n'est pas utilisé. Le ProsodyScore n'est disponible qu'en `en-US` ; **il n'est pas utilisé**, afin que les candidats anglophones soient évalués sur le même construit que les candidats des six autres langues.

**Traits de variété à ne jamais compter comme écart :** rhoticité ou son absence · *t*-flapping · voyelle de BATH · *gotten* / *got* · variétés GB, US, AU, IE, IN, SG, africaines · absence de réduction vocalique chez un locuteur non natif dont l'accent lexical est correct.

**Ce qui fonde la bande, et ce qui ne la fonde pas.** L'AccuracyScore mesure la proximité au locuteur natif. Utilisé en conversion linéaire, il réintroduirait par voie technique la norme native que la grille écarte. La bande de prononciation se décide donc sur trois indicateurs de **contrôle** :

- nombre de mots dont l'identification a échoué ;
- **dispersion** des scores phonémiques sur la durée — le locuteur tient-il sa réalisation, quelle qu'elle soit ;
- déviation systématique sur les contrastes fonctionnellement chargés de l'anglais : placement de l'accent lexical, groupes consonantiques finaux, opposition de longueur vocalique.

---

## 6. Étape E — Détection croisée

```python
def masquages(mots_deepgram, mots_azure, seuil_conf=0.6, seuil_acc=80):
    return [
        {"mot": d["mot"], "horodatage": d["debut"]}
        for d, a in zip(mots_deepgram, mots_azure)
        if d["confiance"] < seuil_conf and a["AccuracyScore"] > seuil_acc
    ]
```

Confiance de transcription basse combinée à un score de prononciation élevé : signature d'un mot mal prononcé, mal transcrit, puis évalué contre sa propre transcription erronée. Au-delà de trois occurrences, la prononciation n'est pas notée automatiquement et part en revue humaine.

---

## 7. Étape F — Prompt de relevé lexico-grammatical et interactionnel

```
Tu es analyste linguistique. Tu examines la transcription horodatée d'un entretien
oral conduit en anglais avec un candidat.

Ta tâche est UNIQUEMENT descriptive.

INTERDICTIONS ABSOLUES :
- Ne mentionne aucun niveau (A1, A2, B1, B2, C1, C2), aucune note, aucun score.
- N'emploie aucun terme d'appréciation : bon, faible, correct, riche, pauvre.
- Ne corrige pas et ne reformule pas.
- Ne relève AUCUN fait à partir d'un segment marqué non fiable.
- Ne compte JAMAIS comme erreur une marque d'oralité normale : répétition de
  planification, amorce, ellipse, hésitation remplie, contraction.
- N'infère rien sur l'origine ou la langue maternelle du candidat.

RÈGLE DE PREUVE : chaque fait est accompagné de l'extrait exact et de son
horodatage. Un fait sans extrait n'est pas relevé.

TRANSCRIPTION HORODATÉE (tours du candidat uniquement) :
<<<{transcription}>>>

SEGMENTS MARQUÉS NON FIABLES : <<<{segments}>>>
TOURS DE L'AGENT, pour le contexte interactionnel : <<<{tours_agent}>>>
PHASES DE L'ENTRETIEN ET LEURS CONSIGNES : <<<{phases}>>>

Rends un objet JSON strict.

{
  "couverture_des_phases": [
    { "phase": 1, "tache_traitee": true, "extrait": "", "elements_non_traites": [""] }
  ],

  "syntaxe": {
    "subordonnees": [ { "type": "relative|complétive|circonstancielle|conditionnelle", "conjonction": "", "extrait": "", "horodatage": "" } ],
    "temps_employes": [ { "temps": "present simple|present perfect|past simple|past perfect|future|conditional", "extrait": "", "horodatage": "" } ],
    "aspect_perfectif": [ { "extrait": "", "emploi": "conforme|non conforme" } ],
    "passif": [ { "extrait": "" } ],
    "structures_complexes": [ { "type": "clause en -ing initiale|inversion|clivée|nominalisation", "extrait": "" } ],
    "questions_formulees_par_le_candidat": [ { "extrait": "" } ]
  },

  "morphosyntaxe_anglaise": {
    "s_troisieme_personne": [ { "extrait": "", "constat": "conforme|non conforme" } ],
    "articles": [ { "extrait": "", "constat": "conforme|non conforme" } ],
    "passe_irregulier": [ { "extrait": "", "constat": "conforme|non conforme" } ],
    "auxiliaire_do": [ { "extrait": "", "constat": "conforme|non conforme" } ],
    "accord_sujet_verbe": [ { "extrait": "", "constat": "conforme|non conforme" } ],
    "prepositions": [ { "extrait": "", "constat": "conforme|non conforme" } ]
  },

  "lexique": {
    "items_hors_haute_frequence": [ { "mot": "", "extrait": "" } ],
    "verbes_a_particule": [ { "extrait": "", "emploi": "conforme|non conforme" } ],
    "expressions_idiomatiques": [ { "extrait": "", "emploi": "conforme|non conforme" } ],
    "collocations": [ { "extrait": "", "emploi": "conforme|non conforme" } ],
    "repetitions_lexicales": [ { "mot": "", "occurrences": 0 } ],
    "paraphrases_de_contournement": [ { "extrait": "", "notion_visee": "" } ],
    "calques_apparents": [ { "extrait": "" } ]
  },

  "cohesion": {
    "connecteurs": [ { "connecteur": "", "extrait": "", "valeur": "addition|opposition|cause|conséquence|concession|temps", "emploi": "fonctionnel|non fonctionnel" } ],
    "reprises_pronominales": [ { "extrait": "", "referent_identifiable": true } ],
    "reprises_nominales_variees": [ { "extrait": "" } ],
    "ruptures": [ { "type": "temps|personne|point de vue", "extrait": "" } ],
    "structuration_annoncee": [ { "extrait": "" } ]
  },

  "interaction": {
    "prise_de_tour_sans_sollicitation": [ { "extrait": "", "horodatage": "" } ],
    "reponse_a_la_relance_phase_5": { "traitee": true, "extrait": "", "nature": "concession|réfutation|nuance|répétition|hors sujet" },
    "reformulation_de_son_propre_propos": [ { "extrait": "" } ],
    "demandes_de_clarification": [ { "extrait": "" } ],
    "marqueurs_de_maintien_du_tour": [ { "extrait": "" } ],
    "marqueurs_d_ecoute": [ { "extrait": "" } ],
    "modalisation_et_attenuation": [ { "extrait": "" } ],
    "chevauchements": [ { "extrait": "", "horodatage": "" } ]
  },

  "phenomenes_d_oral": {
    "auto_corrections": [ { "extrait": "", "aboutie": true, "horodatage": "" } ],
    "faux_departs_abandonnes": [ { "extrait": "" } ],
    "recours_a_une_autre_langue": [ { "extrait": "", "langue": "" } ],
    "demandes_d_aide_lexicale": [ { "extrait": "" } ]
  },

  "intelligibilite": {
    "passages_necessitant_une_reecoute": [ { "horodatage": "" } ],
    "passages_non_recuperables": [ { "horodatage": "" } ],
    "contenu_que_j_ai_du_inferer": [ { "extrait": "", "inference_faite": "", "porte_sur_element_central": true } ]
  }
}
```

**Trois champs à comprendre avant d'écrire la grille.** `auto_corrections` avec `aboutie: true` est un **signe positif** à partir de B2 : le locuteur contrôle sa production et la répare. Un correcteur non instruit y voit une hésitation et pénalise le meilleur candidat. `reponse_a_la_relance_phase_5` est le champ qui porte la décision C1/C2 : une simple répétition de la position initiale ne vaut pas réponse à l'objection. Et `contenu_que_j_ai_du_inferer` empêche le modèle d'évaluer sa propre reconstruction du message.

---

## 8. Étape G — Prompt de notation

```
Tu es correcteur d'un test de niveau linguistique certificatif. Tu attribues des
bandes à un entretien oral conduit en anglais.

Tu ne notes PAS à partir d'une impression de lecture. Tu notes à partir des
relevés fournis, et d'eux seuls.

Tu ne notes NI l'aisance NI la prononciation : ces deux critères sont mesurés
ailleurs. N'en tiens aucun compte, même indirectement. La présence d'hésitations,
de reprises ou de marques d'accent dans la transcription ne doit influencer aucune
de tes bandes.

Tu ne produis AUCUN niveau global, AUCUN score, AUCUN quart de niveau : uniquement
une bande par critère.

MÉTHODE :
1. Pour chaque critère, parcours les bandes de A1 vers C2. Attribue la bande la
   plus haute dont TOUS les descripteurs sont attestés par au moins un fait relevé.
2. Ne monte pas d'une bande sur une impression, sur la longueur de l'entretien,
   ni sur la seule absence d'erreur. Une bande C1 ou C2 exige une marque POSITIVE
   attestée par un extrait.
3. Cite pour chaque bande les faits qui la justifient, avec leur horodatage.
4. Indique ce qui manquerait pour la bande au-dessus.

RÈGLES IMPÉRATIVES :
- Une auto-correction aboutie est une marque de contrôle, jamais une hésitation.
- Un segment marqué non fiable ne justifie aucune bande, ni haute ni basse.
- Une marque d'oralité normale n'est jamais une erreur.
- En cas d'hésitation entre deux bandes, retiens la plus basse et renseigne
  "hesitation_avec".

GRILLE : <<<{grille §9}>>>
ÉTALONS : <<<{étalons anglais}>>>
RELEVÉ LEXICO-GRAMMATICAL ET INTERACTIONNEL : <<<{sortie étape F}>>>
COUVERTURE DES PHASES : <<<{phases traitées}>>>

{
  "criteres": {
    "adequation_tache": { "bande": "", "faits_justificatifs": [""], "manque_pour_bande_superieure": "", "hesitation_avec": null },
    "lexique":          { "bande": "", "faits_justificatifs": [""], "manque_pour_bande_superieure": "", "hesitation_avec": null },
    "grammaire":        { "bande": "", "faits_justificatifs": [""], "manque_pour_bande_superieure": "", "hesitation_avec": null },
    "cohesion":         { "bande": "", "faits_justificatifs": [""], "manque_pour_bande_superieure": "", "hesitation_avec": null },
    "interaction":      { "bande": "", "faits_justificatifs": [""], "manque_pour_bande_superieure": "", "hesitation_avec": null }
  },
  "phases_exploitables": [1, 2, 3, 4, 5],
  "confiance": "haute|moyenne|basse",
  "motif_confiance_non_haute": "",
  "signalement_recitation": false
}
```

---

## 9. Grille — 7 critères

Cinq critères jugés, deux mesurés. L'ajout du critère d'interaction répond à l'exigence explicite d'évaluer l'expression orale « en ce compris l'interaction », que le format conversationnel rend pour la première fois attestable.

| Critère | Poids | Nature |
|---|---|---|
| Adéquation à la tâche | 15 % | Jugé |
| Étendue lexicale | 15 % | Jugé |
| Grammaire | 15 % | Jugé |
| Cohésion | 10 % | Jugé |
| Interaction | 15 % | Jugé |
| Aisance | 15 % | Mesuré |
| Prononciation | 15 % | Mesuré |

### Adéquation à la tâche

| A1 | Une ou deux phases abordées, par mots isolés ou formules mémorisées |
|---|---|
| **A2** | Phases 1 et 2 traitées ; réponses courtes mais pertinentes |
| **B1** | Phases 1 à 3 traitées ; le récit et l'explication aboutissent |
| **B2** | Phase 4 traitée : une position est prise ET justifiée, non seulement énoncée |
| **C1** | Phase 4 traitée avec hiérarchisation ; au moins une marque de prise en compte du contexte non demandée par la consigne |
| **C2** | Implicites de la consigne traités ; ajustement au destinataire attesté par des choix de formulation repérables |

### Étendue lexicale

| A1 | Mots isolés et expressions figées ; aucune combinaison libre attestée |
|---|---|
| **A2** | Lexique de haute fréquence ; répétitions ≥ 3 occurrences ; aucune paraphrase de contournement |
| **B1** | ≥ 3 items hors haute fréquence ; au moins une paraphrase de contournement réussie |
| **B2** | ≥ 6 items hors haute fréquence ; verbes à particule courants employés correctement ; collocations conformes ; au plus un calque |
| **C1** | Au moins une expression idiomatique correctement employée ; aucun calque ; variation lexicale sur les notions reprises |
| **C2** | Choix lexical portant une nuance identifiable — intensité, modalité, connotation — attestée par l'extrait |

### Grammaire

| A1 | Énoncés d'un ou deux éléments ; verbe conjugué absent ou non systématique |
|---|---|
| **A2** | Coordination ; au plus une subordonnée ; present et past simple ; erreurs fréquentes sur le *-s* de 3e personne et les articles |
| **B1** | ≥ 2 subordonnées de types différents ; ≥ 2 temps dont un passé ; *do* auxiliaire contrôlé ; erreurs sur les structures complexes seulement |
| **B2** | ≥ 4 subordonnées ; présence d'un present perfect employé conformément, OU d'un passif, OU d'un conditionnel ; articles majoritairement conformes |
| **C1** | Deux structures complexes de types différents ; densité informative attestée ; erreurs rares et non systématiques |
| **C2** | Variation syntaxique servant l'organisation du propos — mise en relief, clivée, inversion — ; aucune erreur relevée |

### Cohésion

| A1 | Aucun connecteur, ou connecteur additif seul ; énoncés indépendants |
|---|---|
| **A2** | *and*, *but*, *because* fonctionnels ; reprises pronominales à référent identifiable |
| **B1** | ≥ 2 connecteurs de valeurs différentes ; au plus une rupture de temps ou de personne |
| **B2** | Aucune rupture ; progression sans retour en arrière ; ouverture et clôture des tours marquées |
| **C1** | Connecteurs argumentatifs — concession, opposition — fonctionnels ; au moins une reprise nominale variée |
| **C2** | Structuration d'ensemble annoncée et tenue ; cohésion assurée par des moyens variés au-delà des connecteurs |

### Interaction

| A1 | Répond par mots isolés ; ne prend jamais le tour spontanément |
|---|---|
| **A2** | Répond de façon pertinente aux questions directes ; ne relance pas |
| **B1** | Développe au-delà de la question posée ; demande une clarification si nécessaire |
| **B2** | Répond à la relance de la phase 5 par une concession, une réfutation ou une nuance — la simple répétition de la position initiale ne suffit pas ; marqueurs de maintien du tour attestés |
| **C1** | Reformule son propre propos sous la contrainte de l'objection ; modalisation et atténuation employées ; prend le tour sans y être invité |
| **C2** | Réoriente le propos autour de la difficulté sans rupture perceptible ; gère l'objection en préservant sa position, attesté par extrait |

### Aisance — mesuré

Bande déterminée par la combinaison FluencyScore ⊕ MLR ⊕ latence médiane de prise de tour, selon les seuils du §4. En cas de divergence de plus d'une bande entre les indicateurs, la plus basse est retenue et l'entretien signalé.

### Prononciation — mesuré

Bande déterminée par les trois indicateurs de contrôle du §5, selon des seuils calibrés pour la locale retenue. Un accent régional ou étranger marqué n'empêche aucune bande, C2 comprise, dès lors qu'aucun échec d'identification n'est relevé et que la réalisation est stable.

---

## 10. Étape H — Agrégation

```python
BANDE   = {"A1":0, "A2":1, "B1":2, "B2":3, "C1":4, "C2":5}
NIVEAUX = ["A1", "A2", "B1", "B2", "C1"]
POIDS   = {"adequation_tache":0.15, "lexique":0.15, "grammaire":0.15,
           "cohesion":0.10, "interaction":0.15, "aisance":0.15,
           "prononciation":0.15}
N = 5

# --- Porte C2 : conjonctive, l'aisance en est exclue ---
juges = ("adequation_tache", "lexique", "grammaire", "cohesion", "interaction")
n_c2  = sum(1 for c in juges if criteres[c]["bande"] == "C2")
plancher = min(BANDE[criteres[c]["bande"]] for c in juges)

c2_ouvert = (n_c2 >= 4
             and plancher >= BANDE["C1"]
             and criteres["interaction"]["bande"] == "C2"
             and criteres["prononciation"]["bande"] == "C2"
             and 5 in phases_exploitables)

if c2_ouvert:
    resultat = "C2"
else:
    plafonne  = {c: min(BANDE[b["bande"]], BANDE["C1"]) for c, b in criteres.items()}
    composite = sum(plafonne[c] * p for c, p in POIDS.items())      # 0 à 4
    index     = round(composite / (N - 1) * (4 * N - 1))            # 0 à 19

    # Le niveau ne dépasse pas d'une bande la prononciation
    index = min(index, (plafonne["prononciation"] + 1) * 4 + 3)

    # Plafonds d'intelligibilité
    inf = phono["intelligibilite"]
    if inf["passages_non_recuperables"]:
        index = min(index, 11)                                      # B1.4
    elif any(i["porte_sur_element_central"] for i in inf["contenu_que_j_ai_du_inferer"]):
        index = min(index, 15)                                      # B2.4

    resultat = f"{NIVEAUX[index // 4]}.{index % 4 + 1}"
```

**La porte C2 exige la phase 5.** Sans réponse exploitable à la relance, le C2 n'est pas atteignable, quels que soient les autres critères. C'est ce qui rattache la bande terminale à une preuve interactionnelle et non à l'absence d'erreur.

**L'interaction est requise à C2.** Un candidat impeccable sur la langue mais qui répète sa position au lieu de répondre à l'objection reste C1.

### Portes d'entrée et statuts, calculés en code

| Condition | Statut |
|---|---|
| Audio inaudible, saturé, coupé | `echec_technique` — repassation |
| Aucune parole du candidat | `non_evaluable` |
| Parole effective < 60 s | `non_evaluable` |
| Autre langue sur > 50 % des mots | `non_evaluable` |
| Ratio de parole candidat < 40 % de l'entretien | `revue_humaine` — conduite de l'agent à vérifier |
| Signalement de récitation | `revue_humaine` |
| ≥ 3 masquages détectés (étape E) | Prononciation non notée automatiquement |

---

## 11. Étape I — Validation humaine

Pour l'usage certificatif, la validation est **systématique** sur l'expression orale : le volume d'un test certificatif la rend absorbable, et elle écarte l'objection d'une décision entièrement automatisée conditionnant l'accès à une fonction.

Le réviseur dispose de l'enregistrement, de la transcription horodatée, des métriques, des scores acoustiques, des faits cités avec leurs horodatages, et des bandes proposées avec leur justification. Il se rend directement aux horodatages litigieux plutôt que de réécouter l'entretien. Il valide ou corrige chaque bande, en motivant.

Trois cas appellent un examen renforcé : porte C2 ouverte, résultat à moins d'un quart d'une borne décisionnelle, et tout statut `revue_humaine` du §10.

---

## 12. Ce qui reste à calibrer avant mise en service

**Les seuils temporels et acoustiques.** Les valeurs du §4 sont indicatives. Tant qu'elles ne sont pas ajustées sur des étalons anglais, les critères aisance et prononciation ne devraient pas être activés : un score converti par des seuils arbitraires est moins fiable qu'un modèle de langue instruit.

**Les étalons.** Dix-huit enregistrements pour l'anglais — six niveaux × trois positions — plus deux enregistrements non évaluables et un enregistrement à fort accent pleinement intelligible, qui sert de test de non-régression sur la règle d'accent.

**La stabilité de l'agent.** Elle se vérifie comme la notation : faire conduire par l'agent une série d'entretiens avec des candidats de niveaux contrastés, puis mesurer la longueur moyenne de ses tours, la fréquence de son lexique et la complexité de ses phrases selon le niveau de l'interlocuteur. Si ces indicateurs varient avec le candidat, la contrainte de registre n'est pas tenue et les niveaux ne sont pas comparables. C'est le contrôle qualité le plus spécifique à ce format, et le plus facile à oublier.

**Le portage vers les six autres langues.** La grille, l'agrégation, les portes et le squelette des prompts sont réutilisables tels quels. Sont à réécrire pour chaque langue : les observables morphosyntaxiques de l'étape F, les traits de variété à ne jamais relever, les seuils temporels du §4, la locale acoustique, et les consignes des cinq phases.
