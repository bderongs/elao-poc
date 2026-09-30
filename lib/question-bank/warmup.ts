import type { BankEntry } from "@/lib/question-bank/types";

// Opening question of every session, whatever the starting rung (Track AA-01):
// easy, everyday, answerable by anyone from A1 upward, but open enough that a
// strong speaker can develop. Formal register (vous/u/usted/Lei/Sie), matching
// the rest of the examiner's speech.
export const WARMUP: BankEntry[] = [
  {
    id: "w-home-01",
    domain: "home_city",
    text: {
      en: "Tell me a little about where you live.",
      fr: "Parlez-moi un peu de l'endroit où vous habitez.",
      "nl-BE": "Vertel eens iets over de plek waar u woont.",
      es: "Hábleme un poco del lugar donde vive.",
      it: "Mi parli un po' del posto in cui abita.",
      de: "Erzählen Sie mir ein bisschen von dem Ort, an dem Sie wohnen.",
    },
  },
  {
    id: "w-family-01",
    domain: "family",
    text: {
      en: "Tell me a little about the people you live with.",
      fr: "Parlez-moi un peu des personnes avec qui vous vivez.",
      "nl-BE": "Vertel eens iets over de mensen met wie u samenwoont.",
      es: "Hábleme un poco de las personas con las que vive.",
      it: "Mi parli un po' delle persone con cui vive.",
      de: "Erzählen Sie mir ein bisschen von den Menschen, mit denen Sie zusammenwohnen.",
    },
  },
  {
    id: "w-work-01",
    domain: "work_studies",
    text: {
      en: "What do you do for work or for your studies?",
      fr: "Que faites-vous dans la vie, comme travail ou comme études ?",
      "nl-BE": "Wat doet u als werk of als studie?",
      es: "¿A qué se dedica, en el trabajo o en los estudios?",
      it: "Di che cosa si occupa, come lavoro o come studi?",
      de: "Was machen Sie beruflich oder was studieren Sie?",
    },
  },
  {
    id: "w-hobbies-01",
    domain: "hobbies_free_time",
    text: {
      en: "What do you like to do in your free time?",
      fr: "Qu'aimez-vous faire pendant votre temps libre ?",
      "nl-BE": "Wat doet u graag in uw vrije tijd?",
      es: "¿Qué le gusta hacer en su tiempo libre?",
      it: "Che cosa le piace fare nel tempo libero?",
      de: "Was machen Sie gern in Ihrer Freizeit?",
    },
  },
  {
    id: "w-hobbies-02",
    domain: "hobbies_free_time",
    text: {
      en: "What are you going to do this weekend?",
      fr: "Qu'allez-vous faire ce week-end ?",
      "nl-BE": "Wat gaat u dit weekend doen?",
      es: "¿Qué va a hacer este fin de semana?",
      it: "Che cosa farà questo fine settimana?",
      de: "Was machen Sie am Wochenende?",
    },
  },
  {
    id: "w-food-01",
    domain: "food_daily_life",
    text: {
      en: "What do you usually have for breakfast?",
      fr: "Que prenez-vous d'habitude au petit-déjeuner ?",
      "nl-BE": "Wat eet u meestal als ontbijt?",
      es: "¿Qué suele desayunar?",
      it: "Che cosa mangia di solito a colazione?",
      de: "Was essen Sie normalerweise zum Frühstück?",
    },
  },
  {
    id: "w-food-02",
    domain: "food_daily_life",
    text: {
      en: "What is your favourite meal of the day, and why?",
      fr: "Quel est votre repas préféré de la journée, et pourquoi ?",
      "nl-BE": "Wat is uw favoriete maaltijd van de dag, en waarom?",
      es: "¿Cuál es su comida favorita del día, y por qué?",
      it: "Qual è il suo pasto preferito della giornata, e perché?",
      de: "Welche Mahlzeit des Tages mögen Sie am liebsten, und warum?",
    },
  },
  {
    id: "w-other-01",
    domain: "opinions_other",
    text: {
      en: "How is your day going so far?",
      fr: "Comment se passe votre journée jusqu'ici ?",
      "nl-BE": "Hoe verloopt uw dag tot nu toe?",
      es: "¿Qué tal va su día hasta ahora?",
      it: "Come sta andando la sua giornata finora?",
      de: "Wie läuft Ihr Tag bisher?",
    },
  },
  {
    id: "w-travel-01",
    domain: "travel",
    text: {
      en: "Where did you go on your last holiday?",
      fr: "Où êtes-vous parti pendant vos dernières vacances ?",
      "nl-BE": "Waar bent u naartoe geweest op uw laatste vakantie?",
      es: "¿Adónde fue en sus últimas vacaciones?",
      it: "Dove è andato durante le sue ultime vacanze?",
      de: "Wohin sind Sie in Ihrem letzten Urlaub gefahren?",
    },
  },
  {
    id: "w-tech-01",
    domain: "technology",
    text: {
      en: "Which app do you use most on your phone, and what for?",
      fr: "Quelle application utilisez-vous le plus sur votre téléphone, et pour quoi faire ?",
      "nl-BE": "Welke app gebruikt u het meest op uw gsm, en waarvoor?",
      es: "¿Qué aplicación usa más en su móvil, y para qué?",
      it: "Quale app usa di più sul telefono, e per fare che cosa?",
      de: "Welche App benutzen Sie am meisten auf Ihrem Handy, und wofür?",
    },
  },
];
