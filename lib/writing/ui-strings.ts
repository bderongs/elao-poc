/**
 * Candidate-facing text of the written test (/ecrit). MVP: French and
 * English only; the other interface languages fall back to English. Kept
 * apart from lib/ui-strings.ts so the speaking test's dictionaries (typed to
 * cover all six languages) are untouched.
 */
import type { UiLang } from "@/lib/ui-strings";
import type { AppliedCap, FactCategory, WritingLang } from "./types";
import { WORD_LIMITS } from "./grid";

const { min: MIN, target: TARGET, max: MAX } = WORD_LIMITS;

const fr = {
  topBarSuffix: "· évaluation écrite",
  mvpNotice: "Version de test : vos textes et votre résultat ne sont pas enregistrés.",
  intro: {
    eyebrow: "Évaluation écrite · CECRL",
    titleLine1: "Votre niveau à l'écrit,",
    titleLine2: "en trois textes courts.",
    lead: `Trois sujets du quotidien, de plus en plus exigeants. Pour chacun, écrivez un texte de ${MIN} à ${TARGET} mots. Il n'y a rien à préparer.`,
    steps: [
      ["Choisissez la langue", "Le français ou l'anglais."],
      ["Écrivez trois textes", `De ${MIN} à ${TARGET} mots chacun, à votre rythme.`],
      ["Recevez votre niveau", "De A1 à C2, avec le détail par critère."],
    ] as [string, string][],
    languageLabel: "LANGUE DU TEST",
    start: "Commencer",
    rules: "Écrivez seul(e), sans dictionnaire ni correcteur. Le copier-coller est désactivé.",
  },
  langName: { fr: "Français", en: "English" } as Record<WritingLang, string>,
  task: {
    counter: (i: number, n: number) => `Tâche ${i} sur ${n}`,
    instructionsLabel: "CONSIGNE",
    placeholder: "Écrivez votre texte ici…",
    words: (n: number) => `${n} mot${n > 1 ? "s" : ""}`,
    range: `${MIN} à ${TARGET} mots`,
    tooShort: (n: number) => `Encore ${MIN - n} mot${MIN - n > 1 ? "s" : ""} pour atteindre le minimum de ${MIN}.`,
    overTarget: `Votre texte dépasse ${TARGET} mots. Vous pouvez continuer, mais restez sous ${MAX}.`,
    tooLong: `Raccourcissez votre texte : ${MAX} mots au maximum.`,
    pasteBlocked: "Le copier-coller est désactivé : écrivez votre texte vous-même.",
    next: "Tâche suivante",
    finish: "Terminer et voir mon résultat",
    back: "← Tâche précédente",
    home: "← Accueil",
  },
  evaluating: {
    labels: ["ANALYSE EN COURS", "RELEVÉ DES FAITS DE LANGUE", "ATTRIBUTION DES BANDES", "CALCUL DU NIVEAU"],
    title: "C'est terminé, merci.",
    lead: "Nous analysons vos trois textes : adéquation à la tâche, vocabulaire, grammaire, orthographe et cohésion. Cela peut prendre une minute.",
  },
  results: {
    thanks: "Merci.",
    hereIsResult: "Voici votre résultat à l'écrit.",
    levelLabel: "NIVEAU CECRL",
    criteriaLabel: "DÉTAIL PAR CRITÈRE",
    hesitation: "Entre deux bandes : la plus basse est retenue.",
    noEvidence: "Aucun fait relevé ne justifie une bande : la plus basse est retenue.",
    capsLabel: "PLAFONDS APPLIQUÉS",
    beforeCaps: (level: string) => `Niveau avant plafond : ${level}.`,
    cap: { intelligibility: "Le message n'est pas compréhensible sans effort", task_adequacy: "Le niveau ne dépasse pas d'une bande l'adéquation à la tâche", weakest_criterion: "Le niveau ne dépasse pas d'une bande le critère le plus bas" } as Record<AppliedCap["rule"], string>,
    detailToggle: "Voir le relevé détaillé",
    text: (i: number, title: string) => `Texte ${i} · ${title}`,
    yourText: "VOTRE TEXTE",
    coverage: "POINTS DE LA CONSIGNE",
    notCovered: "non traité",
    facts: "FAITS DE LANGUE RELEVÉS",
    interpretations: "PASSAGES INTERPRÉTÉS",
    understoodAs: "compris comme :",
    dropped: (n: number) => `${n} élément${n > 1 ? "s" : ""} écarté${n > 1 ? "s" : ""} par les contrôles (extrait introuvable dans le texte ou formulation évaluative).`,
    none: "aucun",
    departures: (text: number, n: number, words: number) => `Texte ${text} : ${n} écart${n > 1 ? "s" : ""} relevé${n > 1 ? "s" : ""} sur ${words} mots`,
    departureMark: "écart",
    newTest: "Nouveau test",
    evalFailed: "L'analyse n'a pas abouti. Vos textes sont conservés : vous pouvez la relancer.",
    rateLimited: "Trop d'analyses depuis ce réseau. Réessayez dans quelques minutes.",
    retry: "Relancer l'analyse",
    editTexts: "Revenir à mes textes",
    meta: (model: string, version: string, seconds: number) => `Modèle ${model} · ${version} · ${seconds} s`,
    categories: {
      subordination: "Subordonnées",
      tenses: "Temps et modes",
      connectors: "Connecteurs",
      vocabulary: "Vocabulaire",
      agreement: "Accords",
      spelling: "Orthographe",
      punctuation: "Ponctuation",
      pronoun_reference: "Reprises",
      sentence_structure: "Structure des phrases",
      other: "Autres",
    } as Record<FactCategory, string>,
  },
};

export type WritingStrings = typeof fr;

const en: WritingStrings = {
  topBarSuffix: "· written assessment",
  mvpNotice: "Test version: your texts and your result are not saved.",
  intro: {
    eyebrow: "Written assessment · CEFR",
    titleLine1: "Your writing level,",
    titleLine2: "in three short texts.",
    lead: `Three everyday topics, each more demanding than the last. For each one, write a text of ${MIN} to ${TARGET} words. There is nothing to prepare.`,
    steps: [
      ["Choose the language", "French or English."],
      ["Write three texts", `${MIN} to ${TARGET} words each, at your own pace.`],
      ["Get your level", "From A1 to C2, with the detail for each criterion."],
    ],
    languageLabel: "TEST LANGUAGE",
    start: "Start",
    rules: "Write on your own, without a dictionary or spell checker. Copy and paste is disabled.",
  },
  langName: { fr: "Français", en: "English" },
  task: {
    counter: (i, n) => `Task ${i} of ${n}`,
    instructionsLabel: "INSTRUCTIONS",
    placeholder: "Write your text here…",
    words: (n) => `${n} word${n === 1 ? "" : "s"}`,
    range: `${MIN} to ${TARGET} words`,
    tooShort: (n) => `${MIN - n} more word${MIN - n === 1 ? "" : "s"} to reach the minimum of ${MIN}.`,
    overTarget: `Your text is over ${TARGET} words. You can go on, but stay under ${MAX}.`,
    tooLong: `Shorten your text: ${MAX} words at most.`,
    pasteBlocked: "Copy and paste is disabled: please type your text yourself.",
    next: "Next task",
    finish: "Finish and see my result",
    back: "← Previous task",
    home: "← Home",
  },
  evaluating: {
    labels: ["ANALYSIS IN PROGRESS", "SURVEYING LANGUAGE FACTS", "ASSIGNING BANDS", "COMPUTING THE LEVEL"],
    title: "All done, thank you.",
    lead: "We are analysing your three texts: task fulfilment, vocabulary, grammar, spelling and cohesion. This can take a minute.",
  },
  results: {
    thanks: "Thank you.",
    hereIsResult: "Here is your writing result.",
    levelLabel: "CEFR LEVEL",
    criteriaLabel: "DETAIL BY CRITERION",
    hesitation: "Between two bands: the lower one is kept.",
    noEvidence: "No surveyed fact supports a band: the lowest one is kept.",
    capsLabel: "CAPS APPLIED",
    beforeCaps: (level) => `Level before the cap: ${level}.`,
    cap: { intelligibility: "The message cannot be understood without effort", task_adequacy: "The level is at most one band above task fulfilment", weakest_criterion: "The level is at most one band above the weakest criterion" },
    detailToggle: "See the detailed survey",
    text: (i, title) => `Text ${i} · ${title}`,
    yourText: "YOUR TEXT",
    coverage: "POINTS OF THE INSTRUCTIONS",
    notCovered: "not addressed",
    facts: "LANGUAGE FACTS SURVEYED",
    interpretations: "PASSAGES INTERPRETED",
    understoodAs: "understood as:",
    dropped: (n) => `${n} item${n === 1 ? "" : "s"} removed by the checks (excerpt not found in the text, or evaluative wording).`,
    none: "none",
    departures: (text, n, words) => `Text ${text}: ${n} departure${n === 1 ? "" : "s"} from the standard in ${words} words`,
    departureMark: "departure",
    newTest: "New test",
    evalFailed: "The analysis did not complete. Your texts are kept: you can run it again.",
    rateLimited: "Too many analyses from this network. Try again in a few minutes.",
    retry: "Run the analysis again",
    editTexts: "Back to my texts",
    meta: (model, version, seconds) => `Model ${model} · ${version} · ${seconds} s`,
    categories: {
      subordination: "Subordinate clauses",
      tenses: "Tenses and moods",
      connectors: "Connectors",
      vocabulary: "Vocabulary",
      agreement: "Agreement",
      spelling: "Spelling",
      punctuation: "Punctuation",
      pronoun_reference: "References",
      sentence_structure: "Sentence structure",
      other: "Other",
    },
  },
};

export function writingStrings(lang: UiLang): WritingStrings {
  return lang === "fr" ? fr : en;
}
