import type { BankEntry } from "@/lib/question-bank/types";

// A1 — one concept at a time, present tense, the most common words. Every
// question still needs a short clause to answer truthfully, not a single word
// (see doc/assessment_process.md on close-ended A1/A2 questions). Kept short
// on purpose: the wording is what a beginner hears, so it is written per
// language here rather than translated by the model.
export const A1: BankEntry[] = [
  {
    id: "a1-home-01",
    domain: "home_city",
    text: {
      en: "Where are you from, and where do you live now?",
      fr: "D'où venez-vous, et où habitez-vous maintenant ?",
      "nl-BE": "Waar komt u vandaan, en waar woont u nu?",
      es: "¿De dónde es, y dónde vive ahora?",
      it: "Di dov'è, e dove abita adesso?",
      de: "Woher kommen Sie, und wo wohnen Sie jetzt?",
    },
  },
  {
    id: "a1-home-02",
    domain: "home_city",
    text: {
      en: "Do you live in a house or a flat? Do you like it?",
      fr: "Vous habitez dans une maison ou un appartement ? Vous l'aimez ?",
      "nl-BE": "Woont u in een huis of een appartement? Vindt u het leuk?",
      es: "¿Vive en una casa o en un piso? ¿Le gusta?",
      it: "Abita in una casa o in un appartamento? Le piace?",
      de: "Wohnen Sie in einem Haus oder in einer Wohnung? Gefällt es Ihnen?",
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
      en: "What is your job, or what do you study?",
      fr: "Quel est votre travail, ou qu'est-ce que vous étudiez ?",
      "nl-BE": "Wat is uw werk, of wat studeert u?",
      es: "¿En qué trabaja, o qué estudia?",
      it: "Che lavoro fa, o che cosa studia?",
      de: "Was ist Ihr Beruf, oder was studieren Sie?",
    },
  },
  {
    id: "a1-hobbies-01",
    domain: "hobbies_free_time",
    text: {
      en: "What sport do you like, and why?",
      fr: "Quel sport aimez-vous, et pourquoi ?",
      "nl-BE": "Welke sport vindt u leuk, en waarom?",
      es: "¿Qué deporte le gusta, y por qué?",
      it: "Quale sport le piace, e perché?",
      de: "Welchen Sport mögen Sie, und warum?",
    },
  },
  {
    id: "a1-hobbies-02",
    domain: "hobbies_free_time",
    text: {
      en: "Tell me about a pet you have, or one you would like to have.",
      fr: "Parlez-moi d'un animal que vous avez, ou que vous aimeriez avoir.",
      "nl-BE": "Vertel eens over een huisdier dat u hebt, of dat u graag zou hebben.",
      es: "Hábleme de un animal que tiene, o que le gustaría tener.",
      it: "Mi parli di un animale che ha, o che le piacerebbe avere.",
      de: "Erzählen Sie mir von einem Haustier, das Sie haben oder gern hätten.",
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
      en: "What is your favourite food, and why do you like it?",
      fr: "Quel est votre plat préféré, et pourquoi vous l'aimez ?",
      "nl-BE": "Wat is uw lievelingseten, en waarom vindt u het lekker?",
      es: "¿Cuál es su comida favorita, y por qué le gusta?",
      it: "Qual è il suo piatto preferito, e perché le piace?",
      de: "Was ist Ihr Lieblingsessen, und warum mögen Sie es?",
    },
  },
  {
    id: "a1-food-04",
    domain: "food_daily_life",
    text: {
      en: "What time do you get up, and what do you do first?",
      fr: "À quelle heure vous levez-vous, et que faites-vous en premier ?",
      "nl-BE": "Hoe laat staat u op, en wat doet u eerst?",
      es: "¿A qué hora se levanta, y qué hace primero?",
      it: "A che ora si alza, e che cosa fa per prima cosa?",
      de: "Wann stehen Sie auf, und was machen Sie zuerst?",
    },
  },
  {
    id: "a1-other-01",
    domain: "opinions_other",
    text: {
      en: "What is your favourite day of the week, and why?",
      fr: "Quel est votre jour préféré de la semaine, et pourquoi ?",
      "nl-BE": "Wat is uw favoriete dag van de week, en waarom?",
      es: "¿Cuál es su día favorito de la semana, y por qué?",
      it: "Qual è il suo giorno preferito della settimana, e perché?",
      de: "Was ist Ihr Lieblingstag in der Woche, und warum?",
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
      en: "Do you like to travel? Where do you like to go?",
      fr: "Vous aimez voyager ? Où aimez-vous aller ?",
      "nl-BE": "Reist u graag? Waar gaat u graag naartoe?",
      es: "¿Le gusta viajar? ¿Adónde le gusta ir?",
      it: "Le piace viaggiare? Dove le piace andare?",
      de: "Reisen Sie gern? Wohin fahren Sie gern?",
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
