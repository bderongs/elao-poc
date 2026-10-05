import type { BankEntry } from "@/lib/question-bank/types";

// A1 — one concept at a time, present tense, the most common words. ONE short
// question each (no "X, and why?" / second question): the "why" comes from the
// examiner's follow-up turn once the learner has understood and answered. Every
// question still needs a short clause to answer truthfully, not a single word
// (see doc/assessment_process.md on close-ended A1/A2 questions). Kept short
// on purpose: the wording is what a beginner hears, so it is written per
// language here rather than translated by the model.
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
  },
  {
    id: "a1-family-01",
    domain: "family",
    text: {
      en: "Tell me about your brothers or sisters.",
      fr: "Parlez-moi de vos frères ou de vos sœurs.",
      "nl-BE": "Vertel eens over uw broers of zussen.",
      es: "Hábleme de sus hermanos o hermanas.",
      it: "Mi parli dei suoi fratelli o delle sue sorelle.",
      de: "Erzählen Sie mir von Ihren Geschwistern.",
    },
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
  },
];
