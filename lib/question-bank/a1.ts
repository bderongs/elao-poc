import type { BankEntry } from "@/lib/question-bank/types";

// A1 — one concept at a time, present tense, the most common words. ONE short
// question each (no "X, and why?" / second question): the "why" comes from the
// examiner's follow-up turn once the learner has understood and answered. Every
// question still needs a short clause to answer truthfully, not a single word
// (see doc/assessment_process.md on close-ended A1/A2 questions). Kept short
// on purpose: the wording is what a beginner hears, so it is written per
// language here rather than translated by the model. Each entry carries one
// fixed, very short follow-up (also written per language): the code picks the
// question and the follow-up at A1 (lib/examiner-prompt.ts, Track AF-03).
export const A1: BankEntry[] = [
  {
    id: "a1-home-01",
    domain: "home_city",
    text: {
      en: "Where do you live?",
      fr: "Où habitez-vous ?",
      "nl-BE": "Waar woont u?",
      es: "¿Dónde vive?",
      it: "Dove abita?",
      de: "Wo wohnen Sie?",
    },
    followUps: [
      {
        en: "Do you like it?",
        fr: "Vous aimez cet endroit ?",
        "nl-BE": "Vindt u het daar leuk?",
        es: "¿Le gusta ese lugar?",
        it: "Le piace quel posto?",
        de: "Gefällt es Ihnen dort?",
      },
    ],
  },
  {
    id: "a1-home-02",
    domain: "home_city",
    text: {
      en: "Do you live in a house or a flat?",
      fr: "Vous habitez dans une maison ou un appartement ?",
      "nl-BE": "Woont u in een huis of een appartement?",
      es: "¿Vive en una casa o en un piso?",
      it: "Abita in una casa o in un appartamento?",
      de: "Wohnen Sie in einem Haus oder in einer Wohnung?",
    },
    followUps: [
      {
        en: "Is it big or small?",
        fr: "C'est grand ou petit ?",
        "nl-BE": "Is het groot of klein?",
        es: "¿Es grande o pequeño?",
        it: "È grande o piccolo?",
        de: "Ist es groß oder klein?",
      },
    ],
  },
  {
    id: "a1-family-01",
    domain: "family",
    text: {
      en: "Do you have brothers or sisters?",
      fr: "Vous avez des frères ou des sœurs ?",
      "nl-BE": "Hebt u broers of zussen?",
      es: "¿Tiene hermanos o hermanas?",
      it: "Ha fratelli o sorelle?",
      de: "Haben Sie Geschwister?",
    },
    followUps: [
      {
        en: "What is his or her name?",
        fr: "Comment s'appelle-t-il ou elle ?",
        "nl-BE": "Hoe heet hij of zij?",
        es: "¿Cómo se llama?",
        it: "Come si chiama?",
        de: "Wie heißt er oder sie?",
      },
    ],
  },
  {
    id: "a1-family-02",
    domain: "family",
    text: {
      en: "Who do you live with?",
      fr: "Avec qui habitez-vous ?",
      "nl-BE": "Met wie woont u samen?",
      es: "¿Con quién vive?",
      it: "Con chi abita?",
      de: "Mit wem wohnen Sie zusammen?",
    },
    followUps: [
      {
        en: "Do you like that?",
        fr: "Vous aimez ça ?",
        "nl-BE": "Vindt u dat leuk?",
        es: "¿Le gusta?",
        it: "Le piace?",
        de: "Gefällt Ihnen das?",
      },
    ],
  },
  {
    id: "a1-work-01",
    domain: "work_studies",
    text: {
      en: "Do you work or do you study?",
      fr: "Vous travaillez ou vous étudiez ?",
      "nl-BE": "Werkt u of studeert u?",
      es: "¿Trabaja o estudia?",
      it: "Lavora o studia?",
      de: "Arbeiten Sie oder studieren Sie?",
    },
    followUps: [
      {
        en: "What do you do?",
        fr: "Qu'est-ce que vous faites ?",
        "nl-BE": "Wat doet u?",
        es: "¿Qué hace?",
        it: "Che cosa fa?",
        de: "Was machen Sie?",
      },
    ],
  },
  {
    id: "a1-hobbies-01",
    domain: "hobbies_free_time",
    text: {
      en: "What sport do you like?",
      fr: "Quel sport aimez-vous ?",
      "nl-BE": "Welke sport vindt u leuk?",
      es: "¿Qué deporte le gusta?",
      it: "Quale sport le piace?",
      de: "Welchen Sport mögen Sie?",
    },
    followUps: [
      {
        en: "When do you do it?",
        fr: "Quand est-ce que vous en faites ?",
        "nl-BE": "Wanneer doet u dat?",
        es: "¿Cuándo lo hace?",
        it: "Quando lo fa?",
        de: "Wann machen Sie das?",
      },
    ],
  },
  {
    id: "a1-hobbies-02",
    domain: "hobbies_free_time",
    text: {
      en: "Do you have a pet?",
      fr: "Vous avez un animal ?",
      "nl-BE": "Hebt u een huisdier?",
      es: "¿Tiene una mascota?",
      it: "Ha un animale?",
      de: "Haben Sie ein Haustier?",
    },
    followUps: [
      {
        en: "What is its name?",
        fr: "Comment s'appelle-t-il ?",
        "nl-BE": "Hoe heet het?",
        es: "¿Cómo se llama?",
        it: "Come si chiama?",
        de: "Wie heißt es?",
      },
    ],
  },
  {
    id: "a1-food-01",
    domain: "food_daily_life",
    text: {
      en: "What do you like to eat?",
      fr: "Qu'est-ce que vous aimez manger ?",
      "nl-BE": "Wat eet u graag?",
      es: "¿Qué le gusta comer?",
      it: "Che cosa le piace mangiare?",
      de: "Was essen Sie gern?",
    },
    followUps: [
      {
        en: "Why do you like it?",
        fr: "Pourquoi vous aimez ça ?",
        "nl-BE": "Waarom vindt u dat lekker?",
        es: "¿Por qué le gusta?",
        it: "Perché le piace?",
        de: "Warum mögen Sie das?",
      },
    ],
  },
  {
    id: "a1-food-02",
    domain: "food_daily_life",
    text: {
      en: "What do you eat in the morning?",
      fr: "Qu'est-ce que vous mangez le matin ?",
      "nl-BE": "Wat eet u 's morgens?",
      es: "¿Qué come por la mañana?",
      it: "Che cosa mangia la mattina?",
      de: "Was essen Sie am Morgen?",
    },
    followUps: [
      {
        en: "Do you drink coffee or tea?",
        fr: "Vous buvez du café ou du thé ?",
        "nl-BE": "Drinkt u koffie of thee?",
        es: "¿Bebe café o té?",
        it: "Beve caffè o tè?",
        de: "Trinken Sie Kaffee oder Tee?",
      },
    ],
  },
  {
    id: "a1-food-03",
    domain: "food_daily_life",
    text: {
      en: "What is your favourite food?",
      fr: "Quel est votre plat préféré ?",
      "nl-BE": "Wat is uw lievelingseten?",
      es: "¿Cuál es su comida favorita?",
      it: "Qual è il suo piatto preferito?",
      de: "Was ist Ihr Lieblingsessen?",
    },
    followUps: [
      {
        en: "Who makes it?",
        fr: "Qui le prépare ?",
        "nl-BE": "Wie maakt het klaar?",
        es: "¿Quién lo prepara?",
        it: "Chi lo prepara?",
        de: "Wer macht es?",
      },
    ],
  },
  {
    id: "a1-food-04",
    domain: "food_daily_life",
    text: {
      en: "What time do you get up?",
      fr: "À quelle heure vous levez-vous ?",
      "nl-BE": "Hoe laat staat u op?",
      es: "¿A qué hora se levanta?",
      it: "A che ora si alza?",
      de: "Wann stehen Sie auf?",
    },
    followUps: [
      {
        en: "Do you go to bed late or early?",
        fr: "Vous vous couchez tard ou tôt ?",
        "nl-BE": "Gaat u laat of vroeg slapen?",
        es: "¿Se acuesta tarde o temprano?",
        it: "Va a letto tardi o presto?",
        de: "Gehen Sie spät oder früh ins Bett?",
      },
    ],
  },
  {
    id: "a1-other-01",
    domain: "opinions_other",
    text: {
      en: "What is your favourite day of the week?",
      fr: "Quel est votre jour préféré de la semaine ?",
      "nl-BE": "Wat is uw favoriete dag van de week?",
      es: "¿Cuál es su día favorito de la semana?",
      it: "Qual è il suo giorno preferito della settimana?",
      de: "Was ist Ihr Lieblingstag in der Woche?",
    },
    followUps: [
      {
        en: "Why?",
        fr: "Pourquoi ?",
        "nl-BE": "Waarom?",
        es: "¿Por qué?",
        it: "Perché?",
        de: "Warum?",
      },
    ],
  },
  {
    id: "a1-other-02",
    domain: "opinions_other",
    text: {
      en: "What languages do you speak?",
      fr: "Quelles langues parlez-vous ?",
      "nl-BE": "Welke talen spreekt u?",
      es: "¿Qué idiomas habla?",
      it: "Quali lingue parla?",
      de: "Welche Sprachen sprechen Sie?",
    },
    followUps: [
      {
        en: "Where do you speak them?",
        fr: "Où est-ce que vous les parlez ?",
        "nl-BE": "Waar spreekt u ze?",
        es: "¿Dónde los habla?",
        it: "Dove li parla?",
        de: "Wo sprechen Sie sie?",
      },
    ],
  },
  {
    id: "a1-travel-01",
    domain: "travel",
    text: {
      en: "Do you like to travel?",
      fr: "Vous aimez voyager ?",
      "nl-BE": "Reist u graag?",
      es: "¿Le gusta viajar?",
      it: "Le piace viaggiare?",
      de: "Reisen Sie gern?",
    },
    followUps: [
      {
        en: "Which country do you like?",
        fr: "Quel pays vous aimez ?",
        "nl-BE": "Welk land vindt u mooi?",
        es: "¿Qué país le gusta?",
        it: "Quale paese le piace?",
        de: "Welches Land mögen Sie?",
      },
    ],
  },
  {
    id: "a1-tech-01",
    domain: "technology",
    text: {
      en: "What do you do with your phone every day?",
      fr: "Qu'est-ce que vous faites avec votre téléphone tous les jours ?",
      "nl-BE": "Wat doet u elke dag met uw gsm?",
      es: "¿Qué hace con su móvil todos los días?",
      it: "Che cosa fa con il telefono tutti i giorni?",
      de: "Was machen Sie jeden Tag mit Ihrem Handy?",
    },
    followUps: [
      {
        en: "Do you call or send messages?",
        fr: "Vous appelez ou vous écrivez ?",
        "nl-BE": "Belt u of stuurt u berichten?",
        es: "¿Llama o escribe mensajes?",
        it: "Chiama o scrive messaggi?",
        de: "Rufen Sie an oder schreiben Sie Nachrichten?",
      },
    ],
  },
];
