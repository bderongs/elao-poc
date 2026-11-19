/**
 * The written test's scoring grid — PROVISIONAL (2026-11-19), to be replaced
 * by the client's grid. Everything the client may correct lives here: the
 * criteria, their weights, the band descriptors, and the caps. The logic in
 * lib/writing/score.ts and the prompts read this file and need no change
 * when it does.
 *
 * Descriptors are paraphrased from the CEFR Companion Volume's written
 * assessment criteria and its range / accuracy / orthographic control /
 * coherence scales, narrowed to what a 50–100-word text can show.
 */
import type { Band, Criterion } from "./types";

export const GRID_VERSION = "provisional-2026-11-19";

export interface CriterionSpec {
  /** Label shown to the candidate, per interface language. */
  label: { fr: string; en: string };
  /** Share of the overall level. The weights add up to 1. */
  weight: number;
  /** What the criterion looks at — given to the band pass. */
  scope: string;
  /** Which survey categories usually support it — a hint for the band pass, not a filter. */
  categories: string[];
  descriptors: Record<Band, string>;
}

export const GRID: Record<Criterion, CriterionSpec> = {
  task_adequacy: {
    label: { fr: "Adéquation à la tâche", en: "Task fulfilment" },
    weight: 0.2,
    scope: "Ce que le texte fait de la consigne : points de la consigne traités, développement de ces points, registre et forme adaptés au type de texte demandé.",
    categories: ["coverage"],
    descriptors: {
      A1: "Un seul point de la consigne est traité, par des mots ou expressions isolés ; le type de texte demandé n'est pas reconnaissable.",
      A2: "Une partie des points est traitée par des phrases courtes ; le message de base passe, sans développement.",
      B1: "Tous les points, ou presque, sont traités de façon simple et directe ; le type de texte demandé est reconnaissable.",
      B2: "Tous les points sont traités, au moins un avec un développement (raison, exemple, conséquence) ; le registre convient au destinataire.",
      C1: "Tous les points sont traités et développés, avec des liens entre eux ; le registre est tenu sur tout le texte.",
      C2: "Tous les points sont traités avec précision et nuance ; le texte répond exactement à la situation et au destinataire.",
    },
  },
  lexical_range: {
    label: { fr: "Étendue lexicale", en: "Vocabulary range" },
    weight: 0.2,
    scope: "La variété et la précision du vocabulaire : mots hors haute fréquence, expressions idiomatiques, reformulations, répétitions.",
    categories: ["vocabulary"],
    descriptors: {
      A1: "Mots et expressions isolés de très haute fréquence, liés aux besoins immédiats.",
      A2: "Vocabulaire de haute fréquence sur des sujets familiers ; répétitions fréquentes.",
      B1: "Vocabulaire suffisant pour le sujet, avec quelques mots hors haute fréquence ; des périphrases compensent les mots manquants.",
      B2: "Vocabulaire varié sur le sujet, plusieurs mots hors haute fréquence employés à propos ; peu de répétitions.",
      C1: "Vocabulaire étendu et précis, expressions idiomatiques et collocations employées à propos.",
      C2: "Vocabulaire très étendu, nuancé, avec des choix lexicaux précis et des expressions idiomatiques naturelles.",
    },
  },
  grammar: {
    label: { fr: "Étendue et contrôle grammaticaux", en: "Grammar range and control" },
    weight: 0.2,
    scope: "La variété des structures (subordonnées, temps, modes, constructions) et leur maîtrise : accords sujet-verbe, conjugaisons, constructions verbales.",
    categories: ["subordination", "tenses", "agreement", "sentence_structure"],
    descriptors: {
      A1: "Quelques structures simples et mémorisées ; les erreurs sont nombreuses, y compris sur les formes de base.",
      A2: "Phrases simples et coordonnées, présent et un temps du passé ; erreurs systématiques sur les formes de base, mais le sens reste clair.",
      B1: "Quelques subordonnées courantes (relatives, causales, temporelles) et plusieurs temps ; erreurs fréquentes hors des structures familières.",
      B2: "Subordonnées variées et temps employés à propos ; les erreurs ne gênent pas la compréhension et ne sont pas systématiques.",
      C1: "Structures complexes variées (modes, constructions indirectes, mise en relief) ; erreurs rares et ponctuelles.",
      C2: "Structures complexes maîtrisées de façon constante, y compris pour nuancer ; pas d'erreur relevée ou erreurs isolées sans conséquence.",
    },
  },
  formal_accuracy: {
    label: { fr: "Correction formelle", en: "Spelling and punctuation" },
    weight: 0.2,
    scope: "L'orthographe lexicale, les accents, la ponctuation, les majuscules, la mise en forme du texte.",
    categories: ["spelling", "punctuation"],
    descriptors: {
      A1: "Orthographe phonétique sur la plupart des mots ; ponctuation absente ou aléatoire.",
      A2: "Orthographe correcte sur les mots très courants, erreurs nombreuses ailleurs ; ponctuation limitée au point final.",
      B1: "Orthographe correcte sur la plupart des mots courants ; ponctuation suffisante pour suivre le texte, avec des erreurs.",
      B2: "Orthographe et ponctuation correctes dans l'ensemble ; quelques erreurs, sans gêne pour la lecture.",
      C1: "Orthographe et ponctuation correctes, à quelques fautes d'inattention près.",
      C2: "Aucune erreur d'orthographe ou de ponctuation relevée.",
    },
  },
  cohesion: {
    label: { fr: "Cohésion du texte", en: "Cohesion" },
    weight: 0.2,
    scope: "La façon dont les phrases et les idées sont reliées : connecteurs et leur valeur, reprises pronominales et nominales, progression du texte.",
    categories: ["connectors", "pronoun_reference"],
    descriptors: {
      A1: "Mots ou groupes de mots juxtaposés, reliés au mieux par « et » ou « then ».",
      A2: "Phrases reliées par des connecteurs simples (et, mais, parce que) ; peu ou pas de reprises.",
      B1: "Suite linéaire d'éléments reliés par des connecteurs courants ; quelques reprises pronominales.",
      B2: "Connecteurs variés employés selon leur valeur (opposition, conséquence, concession) ; reprises pronominales correctes.",
      C1: "Texte clair et bien enchaîné, connecteurs et reprises variés, progression maîtrisée.",
      C2: "Texte fluide et cohérent, l'organisation et les liens servent le propos sans se faire remarquer.",
    },
  },
};

/**
 * Caps on the overall level, applied in code after the weighted average
 * (lib/writing/score.ts). Each one only lowers the level.
 */
export const CAPS = {
  /**
   * "Message pas intelligible sans effort": when the survey had to interpret
   * more than `maxPer100Words` passages per 100 words (over the three texts),
   * the level stops at `cap`.
   */
  intelligibility: { maxPer100Words: 2, cap: "A2" as Band },
  /** The overall level is at most this many bands above the task-adequacy band. */
  taskAdequacyMargin: 1,
  /** The overall level is at most this many bands above the weakest criterion. */
  weakestCriterionMargin: 1,
};

/** Word limits of each production. Below `min` or above `max` the test cannot be submitted; above `target` the candidate is warned. */
export const WORD_LIMITS = { min: 50, target: 100, max: 150 };
