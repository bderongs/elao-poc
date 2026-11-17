/**
 * Candidate-facing interface text, per interface language (roadmap L-02).
 *
 * The interface language is independent of the language being tested: a
 * Dutch speaker can take an English test with a Dutch interface. French is
 * the reference dictionary; every other language is typed against it
 * (`UiStrings`), so a missing or extra key is a compile error.
 *
 * Strings with values are functions. Admin pages stay English and are not
 * here.
 */
import { SESSION_DURATION_MINUTES as MIN, SESSION_LENGTH_MODE } from "@/lib/session-config";
import type { ConvLang } from "@/lib/conversation-prompts";

/** Same value as components/AuthForm.tsx (kept here so this module has no React import). */
const MIN_PASSWORD_LENGTH = 8;

export const UI_LANGS = ["fr", "en", "nl", "es", "it", "de"] as const;
export type UiLang = (typeof UI_LANGS)[number];
export const DEFAULT_UI_LANG: UiLang = "fr";
/** Cookie that remembers the interface language (set from `?ui=`, read by lib/ui-lang.tsx and lib/ui-lang-server.ts). */
export const UI_LANG_COOKIE = "elao_ui_lang";

export function isUiLang(v: unknown): v is UiLang {
  return typeof v === "string" && (UI_LANGS as readonly string[]).includes(v);
}

/** Each interface language in its own name, for the language switcher. */
export const UI_LANG_NATIVE_NAME: Record<UiLang, string> = {
  fr: "Français", en: "English", nl: "Nederlands", es: "Español", it: "Italiano", de: "Deutsch",
};

/** First supported interface language in a browser preference list ("de-AT", "en-GB;q=0.8", …), or null. */
export function uiLangFromPreferences(prefs: readonly string[]): UiLang | null {
  for (const p of prefs) {
    const base = p.split(";")[0].trim().split("-")[0].toLowerCase();
    if (isUiLang(base)) return base;
  }
  return null;
}

/** The interface language matching a test language (nl-BE / nl-NL share the Dutch interface). */
export function uiLangForConvLang(lang: ConvLang | string): UiLang {
  const base = lang.split("-")[0];
  return isUiLang(base) ? base : DEFAULT_UI_LANG;
}

const ADAPTIVE = SESSION_LENGTH_MODE === "adaptive";

const fr = {
  htmlLang: "fr",
  /** How long the conversation lasts, as it reads inside a sentence. */
  sessionLength: ADAPTIVE ? "quelques minutes" : `${MIN} minutes`,
  /** Test languages, as named in this interface (CTA, language select). */
  langName: { fr: "français", en: "anglais", "nl-BE": "néerlandais", "nl-NL": "néerlandais", es: "espagnol", it: "italien", de: "allemand" } as Record<ConvLang, string>,

  welcome: {
    eyebrow: "Évaluation orale · CECRL",
    titleLine1: "Votre niveau de langue,",
    titleLine2: "en une conversation.",
    lead: (len: string, name: string) => `Échangez à voix haute pendant ${len} avec ${name}, notre examinatrice. Ses questions s'adaptent à vos réponses ; il n'y a rien à préparer.`,
    steps: (name: string): [string, string][] => [
      ["Choisissez la langue", "Français, anglais, néerlandais, espagnol, italien ou allemand."],
      [`Parlez avec ${name}`, "Une vraie conversation, au rythme qui vous convient."],
      ["Recevez votre niveau", "De A0 à C2, avec le détail : prononciation, fluidité, vocabulaire, grammaire."],
    ],
    start: "Commencer",
    quietPlace: "Prévoyez un endroit calme et un micro.",
    listen: "Écouter cette page",
    stopListening: "Arrêter la lecture",
  },

  auth: {
    title: "Créez votre compte",
    lead: "Pour retrouver vos résultats et suivre votre progression.",
    back: "← Retour",
    guest: "Continuer sans compte",
  },

  confirmPreference: {
    title: (lang: string, rung: string) => `Continuer en ${lang}, niveau ${rung} ?`,
    lead: "On reprend là où vous vous étiez arrêté(e).",
    continue: "Continuer",
    changeLanguage: "Changer de langue",
  },

  language: {
    titleLine1: "Bonjour. Dans quelle langue",
    titleLine2: "allons-nous parler ?",
    lead: (len: string, name: string) => `Une conversation de ${len} avec ${name}, notre examinatrice. Il n'y a rien à préparer.`,
    continueIn: (lang: string) => `Continuer en ${lang}`,
    micNext: "Vous pourrez vérifier votre micro à l'étape suivante.",
  },

  instructions: {
    topBarSuffix: "· évaluation orale",
    changeLanguageAria: "Changer de langue",
    title: (len: string) => `Votre niveau en ${len}`,
    lead: (name: string) => `${name} vous posera des questions simples sur votre quotidien. Répondez à voix haute, comme dans une vraie conversation.`,
    steps: (name: string): [string, string][] => [
      ["Écoutez la question", "Vous pouvez la faire répéter une fois."],
      ["Parlez librement", "Hésiter, reprendre, se corriger : tout cela est normal."],
      ["Laissez un silence", `${name} comprend que vous avez terminé et enchaîne.`],
    ],
    integrityStep: ["Répondez spontanément", "Sans aide extérieure. Les longs silences avant de répondre et les sorties de cette fenêtre sont enregistrés et visibles par l'évaluateur."] as [string, string],
    micLabel: "VOTRE MICRO",
    micBlocked: "Le micro est bloqué — autorisez l'accès dans les réglages du navigateur.",
    sayHello: "Dites « bonjour » pour vérifier que l'on vous entend bien.",
    noisy: "Votre environnement semble un peu bruyant. Le test fonctionnera, mais vos résultats seront plus fiables dans un endroit plus calme.",
    quiet: "On vous entend faiblement. Rapprochez-vous du micro ou parlez un peu plus fort.",
    micDetected: (label: string) => `Micro détecté — ${label}`,
    micNotDetected: "Micro non détecté",
    micDetecting: "Détection du micro…",
    defaultMic: "Micro par défaut",
    ready: "Je suis prêt",
    noGrades: "Aucune note n'est affichée pendant l'épreuve.",
  },

  session: {
    answers: (n: number) => `${n} réponse${n > 1 ? "s" : ""}`,
    answersAria: (n: number) => `${n} réponse${n > 1 ? "s" : ""} donnée${n > 1 ? "s" : ""}`,
    finish: "Terminer",
    awayNotice: "Merci de rester sur le test et de ne pas quitter cette fenêtre.",
    avatarSpeaking: (name: string) => `${name} vous parle`,
    listenThen: "Écoutez — vous répondrez juste après.",
    yourTurn: "À vous — on vous écoute",
    finishedTitle: (name: string) => `J'ai terminé — si ${name} ne réagit pas à la fin de votre réponse`,
    finishedAria: "J'ai terminé",
    repeat: "Répéter la question",
    notUnderstood: "Je ne comprends pas",
    skip: "Passer",
    confirmSkip: "Passer cette question sans y répondre ?",
    thinking: (name: string) => `${name} prépare la question suivante`,
    doingWell: "Vous vous en sortez bien.",
    micInterrupted: "La session a été interrompue : le micro s'est coupé pendant que l'écran était verrouillé ou l'application en arrière-plan.",
    finishAndSee: "Terminer et voir mon résultat",
    notHeard: "Je n'ai pas bien entendu — pouvez-vous répéter ?",
    examinerError: "L'examinateur rencontre un problème technique, réessayez dans un instant.",
  },

  evaluating: {
    labels: ["ANALYSE EN COURS", "ANALYSE DE LA PRONONCIATION", "ANALYSE DU VOCABULAIRE", "ANALYSE DE LA GRAMMAIRE"],
    title: "C'est terminé, merci.",
    lead: "Nous analysons votre prise de parole : prononciation, fluidité, vocabulaire et grammaire. Votre niveau CECRL s'affichera dans un instant.",
    done: "TERMINÉ",
    canClose: "Vous pouvez fermer cette fenêtre : le rapport vous sera envoyé par e-mail.",
  },

  results: {
    newSession: "Nouvelle session",
    thanks: "Merci d'avoir passé le test.",
    hereIsResult: "Voici votre résultat.",
    evalFailed: "L'évaluation n'a pas pu être finalisée, mais votre session a bien été enregistrée.",
    detailToggle: "Voir le détail : enregistrement et transcription",
    listen: "ÉCOUTER",
    coloredWords: "Les mots colorés dans la transcription ci-dessous indiquent la qualité de prononciation.",
  },

  cefr: {
    eyebrow: "VOTRE NIVEAU",
    score: "Score",
    strengths: "Points forts",
    toImprove: "À travailler",
    notableErrors: "Erreurs notables",
    confidence: {
      high: "FIABLE",
      medium: "MOYEN",
      low: "INDICATIF",
    },
    topOfScale: "Le niveau le plus élevé évalué par ce test. Votre expression orale se situe en haut de notre échelle ; votre niveau est peut-être encore supérieur (C2), ce que cette courte conversation n'est pas conçue pour mesurer.",
    axes: {
      pronunciation: "Prononciation",
      fluency: "Fluidité",
      vocabGram: "Vocab. & gram.",
      communication: "Communication",
    },
    notAvailable: "n/d",
  },

  survey: {
    aria: "Votre avis",
    questions: ["Sur une échelle de 1 à 10, avez-vous apprécié l'expérience ?", "Les questions posées vous ont-elles semblé pertinentes ?", "Le niveau obtenu vous semble-t-il pertinent ?"],
    thanks: "Merci pour votre retour !",
    title: "Votre avis nous intéresse",
    scale: "Trois questions rapides (1 = pas du tout, 10 = tout à fait).",
    comment: "Un commentaire ? (facultatif)",
    failed: "L'envoi a échoué. Vous pouvez réessayer ou passer.",
    skip: "Passer",
    sending: "Envoi…",
    send: "Envoyer",
  },

  claim: {
    title: "Envie de garder ce résultat ?",
    lead: "Créez un compte (ou connectez-vous) pour le retrouver plus tard.",
  },

  nav: {
    interfaceLanguage: "Langue de l'interface",
    mySessions: "Mes sessions",
    signIn: "Se connecter",
  },

  authForm: {
    signIn: "Se connecter",
    signUp: "Créer un compte",
    submitSignUp: "Créer mon compte",
    busy: "Un instant…",
    emailPlaceholder: "vous@exemple.com",
    password: "Mot de passe",
    confirmPassword: "Confirmer le mot de passe",
    forgot: "Mot de passe oublié ?",
    or: "ou",
    google: "Continuer avec Google",
    soon: "Bientôt disponible",
    soonSuffix: " — bientôt disponible",
    checkEmail: ["Vérifiez vos e-mails (", ") pour confirmer votre compte."] as [string, string],
    tooShort: `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`,
    mismatch: "Les deux mots de passe ne correspondent pas.",
    invalidCredentials: "E-mail ou mot de passe incorrect. Première connexion depuis le changement ? Utilisez « Mot de passe oublié ».",
    exists: "Un compte existe déjà avec cet e-mail — connectez-vous.",
    weak: `Mot de passe trop faible (au moins ${MIN_PASSWORD_LENGTH} caractères).`,
    same: "Le nouveau mot de passe doit être différent de l'ancien.",
    rateLimit: "Trop de tentatives, réessayez dans quelques minutes.",
  },

  account: {
    signInTitle: "Se connecter",
    signInLead: "Connectez-vous ou créez un compte pour retrouver vos sessions.",
    linkExpiredLead: "Ce lien a expiré ou a déjà été utilisé. Reconnectez-vous ou demandez un nouveau lien.",
    forgotTitle: "Mot de passe oublié",
    forgotLead: "Indiquez votre e-mail, nous vous envoyons un lien pour en choisir un nouveau.",
    forgotSent: ["Si un compte existe pour ", ", un e-mail vous a été envoyé avec un lien pour choisir un nouveau mot de passe."] as [string, string],
    sending: "Envoi…",
    getLink: "Recevoir le lien",
    expiredTitle: "Lien expiré",
    expiredLead: "Ce lien de réinitialisation n'est plus valide.",
    newLink: "Demander un nouveau lien",
    resetTitle: "Nouveau mot de passe",
    resetFor: ["Pour le compte ", "."] as [string, string],
    newPassword: "Nouveau mot de passe",
    saving: "Enregistrement…",
    savePassword: "Enregistrer le mot de passe",
    savedTitle: "Votre compte est prêt",
    savedLead: "Votre résultat a été sauvegardé. Vous pourrez le retrouver la prochaine fois que vous vous connecterez.",
    seeSessions: "Voir mes sessions",
    retake: "Repasser un test",
  },

  dashboard: {
    signOut: "Se déconnecter",
    hello: "Bonjour",
    lead: "Passez un nouveau test ou retrouvez vos résultats précédents.",
    newTest: "Passer un nouveau test",
    mySessions: "Mes sessions",
    empty: "Aucune session pour l'instant — lancez votre premier test !",
    page: "Page",
    previous: "← Précédent",
    next: "Suivant →",
    back: "← Retour à mes sessions",
    duration: "Durée",
    fullRecording: "Enregistrement complet",
    noEvaluation: "Aucune évaluation enregistrée pour cette session.",
    transcript: "Transcription",
    turn: (n: number) => `tour ${n}`,
  },

  transcript: {
    title: "TRANSCRIPTION",
    empty: "La conversation s'affichera ici…",
    you: "Vous",
  },
};

export type UiStrings = typeof fr;

const en: UiStrings = {
  htmlLang: "en",
  sessionLength: ADAPTIVE ? "a few minutes" : `${MIN} minutes`,
  langName: { fr: "French", en: "English", "nl-BE": "Dutch", "nl-NL": "Dutch", es: "Spanish", it: "Italian", de: "German" },

  welcome: {
    eyebrow: "Speaking assessment · CEFR",
    titleLine1: "Your language level,",
    titleLine2: "in one conversation.",
    lead: (len, name) => `Talk out loud for ${len} with ${name}, our examiner. Her questions adapt to your answers; there is nothing to prepare.`,
    steps: (name) => [
      ["Choose the language", "French, English, Dutch, Spanish, Italian or German."],
      [`Talk with ${name}`, "A real conversation, at your own pace."],
      ["Get your level", "From A0 to C2, with the detail: pronunciation, fluency, vocabulary, grammar."],
    ],
    start: "Start",
    quietPlace: "You'll need a quiet place and a microphone.",
    listen: "Listen to this page",
    stopListening: "Stop",
  },

  auth: {
    title: "Create your account",
    lead: "To find your results again and follow your progress.",
    back: "← Back",
    guest: "Continue without an account",
  },

  confirmPreference: {
    title: (lang, rung) => `Continue in ${lang}, level ${rung}?`,
    lead: "We'll pick up where you left off.",
    continue: "Continue",
    changeLanguage: "Change language",
  },

  language: {
    titleLine1: "Hello. Which language",
    titleLine2: "shall we speak?",
    lead: (len, name) => `A conversation of ${len} with ${name}, our examiner. There is nothing to prepare.`,
    continueIn: (lang) => `Continue in ${lang}`,
    micNext: "You can check your microphone in the next step.",
  },

  instructions: {
    topBarSuffix: "· speaking assessment",
    changeLanguageAria: "Change language",
    title: (len) => `Your level in ${len}`,
    lead: (name) => `${name} will ask you simple questions about your everyday life. Answer out loud, as in a real conversation.`,
    steps: (name) => [
      ["Listen to the question", "You can have it repeated once."],
      ["Speak freely", "Hesitating, starting again, correcting yourself: all of that is normal."],
      ["Leave a pause", `${name} understands you have finished and moves on.`],
    ],
    integrityStep: ["Answer spontaneously", "Without outside help. Long silences before answering and leaving this window are recorded and visible to the assessor."],
    micLabel: "YOUR MICROPHONE",
    micBlocked: "The microphone is blocked — allow access in your browser settings.",
    sayHello: "Say \"hello\" to check that we can hear you clearly.",
    noisy: "Your surroundings seem a little noisy. The test will work, but your results will be more reliable somewhere quieter.",
    quiet: "We can barely hear you. Move closer to the microphone or speak a little louder.",
    micDetected: (label) => `Microphone detected — ${label}`,
    micNotDetected: "Microphone not detected",
    micDetecting: "Detecting the microphone…",
    defaultMic: "Default microphone",
    ready: "I'm ready",
    noGrades: "No marks are shown during the test.",
  },

  session: {
    answers: (n) => `${n} answer${n === 1 ? "" : "s"}`,
    answersAria: (n) => `${n} answer${n === 1 ? "" : "s"} given`,
    finish: "Finish",
    awayNotice: "Please stay on the test and don't leave this window.",
    avatarSpeaking: (name) => `${name} is speaking`,
    listenThen: "Listen — you'll answer right after.",
    yourTurn: "Your turn — we're listening",
    finishedTitle: (name) => `I'm done — if ${name} doesn't react at the end of your answer`,
    finishedAria: "I'm done",
    repeat: "Repeat the question",
    notUnderstood: "I don't understand",
    skip: "Skip",
    confirmSkip: "Skip this question without answering?",
    thinking: (name) => `${name} is preparing the next question`,
    doingWell: "You're doing well.",
    micInterrupted: "The session was interrupted: the microphone stopped while the screen was locked or the app was in the background.",
    finishAndSee: "Finish and see my result",
    notHeard: "I didn't quite hear that — could you say it again?",
    examinerError: "The examiner has a technical problem, please try again in a moment.",
  },

  evaluating: {
    labels: ["ANALYSIS IN PROGRESS", "ANALYSING PRONUNCIATION", "ANALYSING VOCABULARY", "ANALYSING GRAMMAR"],
    title: "That's it, thank you.",
    lead: "We are analysing your speaking: pronunciation, fluency, vocabulary and grammar. Your CEFR level will appear in a moment.",
    done: "DONE",
    canClose: "You can close this window: the report will be sent to you by e-mail.",
  },

  results: {
    newSession: "New session",
    thanks: "Thank you for taking the test.",
    hereIsResult: "Here is your result.",
    evalFailed: "The assessment could not be completed, but your session has been saved.",
    detailToggle: "See the details: recording and transcript",
    listen: "LISTEN",
    coloredWords: "The coloured words in the transcript below show the quality of your pronunciation.",
  },

  cefr: {
    eyebrow: "YOUR LEVEL",
    score: "Score",
    strengths: "Strengths",
    toImprove: "To work on",
    notableErrors: "Notable errors",
    confidence: {
      high: "RELIABLE",
      medium: "MEDIUM",
      low: "INDICATIVE",
    },
    topOfScale: "The highest level this test assesses. Your spoken language is at the top of our scale; your level may be higher still (C2), which this short conversation is not designed to measure.",
    axes: {
      pronunciation: "Pronunciation",
      fluency: "Fluency",
      vocabGram: "Vocab & gram.",
      communication: "Communication",
    },
    notAvailable: "n/a",
  },

  survey: {
    aria: "Your opinion",
    questions: ["On a scale of 1 to 10, did you enjoy the experience?", "Did the questions seem relevant to you?", "Does the level you got seem right to you?"],
    thanks: "Thank you for your feedback!",
    title: "We'd like your opinion",
    scale: "Three quick questions (1 = not at all, 10 = completely).",
    comment: "Any comment? (optional)",
    failed: "Sending failed. You can try again or skip.",
    skip: "Skip",
    sending: "Sending…",
    send: "Send",
  },

  claim: {
    title: "Want to keep this result?",
    lead: "Create an account (or sign in) to find it again later.",
  },

  nav: {
    interfaceLanguage: "Interface language",
    mySessions: "My sessions",
    signIn: "Sign in",
  },

  authForm: {
    signIn: "Sign in",
    signUp: "Create an account",
    submitSignUp: "Create my account",
    busy: "One moment…",
    emailPlaceholder: "you@example.com",
    password: "Password",
    confirmPassword: "Confirm password",
    forgot: "Forgot your password?",
    or: "or",
    google: "Continue with Google",
    soon: "Coming soon",
    soonSuffix: " — coming soon",
    checkEmail: ["Check your e-mails (", ") to confirm your account."] as [string, string],
    tooShort: `The password must be at least ${MIN_PASSWORD_LENGTH} characters long.`,
    mismatch: "The two passwords don't match.",
    invalidCredentials: "Wrong e-mail or password. First sign-in since the change? Use \"Forgot your password\".",
    exists: "An account already exists with this e-mail — sign in.",
    weak: `Password too weak (at least ${MIN_PASSWORD_LENGTH} characters).`,
    same: "The new password must be different from the old one.",
    rateLimit: "Too many attempts, try again in a few minutes.",
  },

  account: {
    signInTitle: "Sign in",
    signInLead: "Sign in or create an account to find your sessions.",
    linkExpiredLead: "This link has expired or has already been used. Sign in again or request a new link.",
    forgotTitle: "Forgot your password",
    forgotLead: "Enter your e-mail and we'll send you a link to choose a new one.",
    forgotSent: ["If an account exists for ", ", we have sent you an e-mail with a link to choose a new password."] as [string, string],
    sending: "Sending…",
    getLink: "Send me the link",
    expiredTitle: "Link expired",
    expiredLead: "This reset link is no longer valid.",
    newLink: "Request a new link",
    resetTitle: "New password",
    resetFor: ["For the account ", "."] as [string, string],
    newPassword: "New password",
    saving: "Saving…",
    savePassword: "Save the password",
    savedTitle: "Your account is ready",
    savedLead: "Your result has been saved. You'll find it again the next time you sign in.",
    seeSessions: "See my sessions",
    retake: "Take the test again",
  },

  dashboard: {
    signOut: "Sign out",
    hello: "Hello",
    lead: "Take a new test or find your previous results.",
    newTest: "Take a new test",
    mySessions: "My sessions",
    empty: "No sessions yet — start your first test!",
    page: "Page",
    previous: "← Previous",
    next: "Next →",
    back: "← Back to my sessions",
    duration: "Duration",
    fullRecording: "Full recording",
    noEvaluation: "No assessment saved for this session.",
    transcript: "Transcript",
    turn: (n: number) => `turn ${n}`,
  },

  transcript: {
    title: "TRANSCRIPT",
    empty: "The conversation will appear here…",
    you: "You",
  },
};

const nl: UiStrings = {
  htmlLang: "nl",
  sessionLength: ADAPTIVE ? "enkele minuten" : `${MIN} minuten`,
  langName: { fr: "Frans", en: "Engels", "nl-BE": "Nederlands", "nl-NL": "Nederlands", es: "Spaans", it: "Italiaans", de: "Duits" },

  welcome: {
    eyebrow: "Mondelinge evaluatie · ERK",
    titleLine1: "Uw taalniveau,",
    titleLine2: "in één gesprek.",
    lead: (len, name) => `Spreek ${len} hardop met ${name}, onze examinator. Haar vragen passen zich aan uw antwoorden aan; u hoeft niets voor te bereiden.`,
    steps: (name) => [
      ["Kies de taal", "Frans, Engels, Nederlands, Spaans, Italiaans of Duits."],
      [`Praat met ${name}`, "Een echt gesprek, in uw eigen tempo."],
      ["Ontvang uw niveau", "Van A0 tot C2, met details: uitspraak, vlotheid, woordenschat, grammatica."],
    ],
    start: "Beginnen",
    quietPlace: "Zorg voor een rustige plek en een microfoon.",
    listen: "Deze pagina beluisteren",
    stopListening: "Stoppen",
  },

  auth: {
    title: "Maak uw account aan",
    lead: "Om uw resultaten terug te vinden en uw vooruitgang te volgen.",
    back: "← Terug",
    guest: "Doorgaan zonder account",
  },

  confirmPreference: {
    title: (lang, rung) => `Doorgaan in het ${lang}, niveau ${rung}?`,
    lead: "We gaan verder waar u gebleven was.",
    continue: "Doorgaan",
    changeLanguage: "Andere taal kiezen",
  },

  language: {
    titleLine1: "Hallo. In welke taal",
    titleLine2: "gaan we spreken?",
    lead: (len, name) => `Een gesprek van ${len} met ${name}, onze examinator. U hoeft niets voor te bereiden.`,
    continueIn: (lang) => `Doorgaan in het ${lang}`,
    micNext: "In de volgende stap kunt u uw microfoon controleren.",
  },

  instructions: {
    topBarSuffix: "· mondelinge evaluatie",
    changeLanguageAria: "Andere taal kiezen",
    title: (len) => `Uw niveau in ${len}`,
    lead: (name) => `${name} stelt u eenvoudige vragen over uw dagelijks leven. Antwoord hardop, zoals in een echt gesprek.`,
    steps: (name) => [
      ["Luister naar de vraag", "U kunt ze één keer laten herhalen."],
      ["Spreek vrijuit", "Aarzelen, opnieuw beginnen, uzelf verbeteren: dat is allemaal normaal."],
      ["Laat een stilte", `${name} begrijpt dat u klaar bent en gaat verder.`],
    ],
    integrityStep: ["Antwoord spontaan", "Zonder hulp van buitenaf. Lange stiltes voor het antwoorden en het verlaten van dit venster worden geregistreerd en zijn zichtbaar voor de beoordelaar."],
    micLabel: "UW MICROFOON",
    micBlocked: "De microfoon is geblokkeerd — sta toegang toe in de instellingen van uw browser.",
    sayHello: "Zeg « hallo » om te controleren of we u goed horen.",
    noisy: "Uw omgeving lijkt wat lawaaierig. De test werkt, maar uw resultaten zullen betrouwbaarder zijn op een rustigere plek.",
    quiet: "We horen u zwak. Ga dichter bij de microfoon zitten of spreek iets luider.",
    micDetected: (label) => `Microfoon gevonden — ${label}`,
    micNotDetected: "Geen microfoon gevonden",
    micDetecting: "Microfoon zoeken…",
    defaultMic: "Standaardmicrofoon",
    ready: "Ik ben klaar",
    noGrades: "Tijdens de test worden geen scores getoond.",
  },

  session: {
    answers: (n) => `${n} antwoord${n === 1 ? "" : "en"}`,
    answersAria: (n) => `${n} antwoord${n === 1 ? "" : "en"} gegeven`,
    finish: "Stoppen",
    awayNotice: "Blijf bij de test en verlaat dit venster niet.",
    avatarSpeaking: (name) => `${name} spreekt`,
    listenThen: "Luister — u antwoordt meteen daarna.",
    yourTurn: "Uw beurt — we luisteren",
    finishedTitle: (name) => `Ik ben klaar — als ${name} niet reageert aan het einde van uw antwoord`,
    finishedAria: "Ik ben klaar",
    repeat: "Vraag herhalen",
    notUnderstood: "Ik begrijp het niet",
    skip: "Overslaan",
    confirmSkip: "Deze vraag overslaan zonder te antwoorden?",
    thinking: (name) => `${name} bereidt de volgende vraag voor`,
    doingWell: "U doet het goed.",
    micInterrupted: "De sessie werd onderbroken: de microfoon viel uit terwijl het scherm vergrendeld was of de app op de achtergrond stond.",
    finishAndSee: "Stoppen en mijn resultaat bekijken",
    notHeard: "Ik heb het niet goed gehoord — kunt u het herhalen?",
    examinerError: "De examinator heeft een technisch probleem, probeer het zo dadelijk opnieuw.",
  },

  evaluating: {
    labels: ["ANALYSE BEZIG", "ANALYSE VAN DE UITSPRAAK", "ANALYSE VAN DE WOORDENSCHAT", "ANALYSE VAN DE GRAMMATICA"],
    title: "Klaar, dank u.",
    lead: "We analyseren uw spreekvaardigheid: uitspraak, vlotheid, woordenschat en grammatica. Uw ERK-niveau verschijnt zo dadelijk.",
    done: "KLAAR",
    canClose: "U kunt dit venster sluiten: het rapport wordt u per e-mail toegestuurd.",
  },

  results: {
    newSession: "Nieuwe sessie",
    thanks: "Bedankt om de test af te leggen.",
    hereIsResult: "Hier is uw resultaat.",
    evalFailed: "De evaluatie kon niet worden afgerond, maar uw sessie is wel opgeslagen.",
    detailToggle: "Details bekijken: opname en transcriptie",
    listen: "BELUISTEREN",
    coloredWords: "De gekleurde woorden in de transcriptie hieronder tonen de kwaliteit van uw uitspraak.",
  },

  cefr: {
    eyebrow: "UW NIVEAU",
    score: "Score",
    strengths: "Sterke punten",
    toImprove: "Werkpunten",
    notableErrors: "Opvallende fouten",
    confidence: {
      high: "BETROUWBAAR",
      medium: "GEMIDDELD",
      low: "INDICATIEF",
    },
    topOfScale: "Het hoogste niveau dat deze test meet. Uw mondelinge taalvaardigheid zit bovenaan onze schaal; uw niveau ligt misschien nog hoger (C2), wat dit korte gesprek niet kan meten.",
    axes: {
      pronunciation: "Uitspraak",
      fluency: "Vlotheid",
      vocabGram: "Woordensch. & gramm.",
      communication: "Communicatie",
    },
    notAvailable: "n.v.t.",
  },

  survey: {
    aria: "Uw mening",
    questions: ["Op een schaal van 1 tot 10, hoe vond u de ervaring?", "Vond u de gestelde vragen relevant?", "Lijkt het behaalde niveau u juist?"],
    thanks: "Bedankt voor uw feedback!",
    title: "Uw mening interesseert ons",
    scale: "Drie korte vragen (1 = helemaal niet, 10 = helemaal wel).",
    comment: "Een opmerking? (optioneel)",
    failed: "Verzenden is mislukt. U kunt het opnieuw proberen of overslaan.",
    skip: "Overslaan",
    sending: "Verzenden…",
    send: "Verzenden",
  },

  claim: {
    title: "Wilt u dit resultaat bewaren?",
    lead: "Maak een account aan (of meld u aan) om het later terug te vinden.",
  },

  nav: {
    interfaceLanguage: "Taal van de interface",
    mySessions: "Mijn sessies",
    signIn: "Aanmelden",
  },

  authForm: {
    signIn: "Aanmelden",
    signUp: "Account aanmaken",
    submitSignUp: "Mijn account aanmaken",
    busy: "Even geduld…",
    emailPlaceholder: "u@voorbeeld.be",
    password: "Wachtwoord",
    confirmPassword: "Wachtwoord bevestigen",
    forgot: "Wachtwoord vergeten?",
    or: "of",
    google: "Doorgaan met Google",
    soon: "Binnenkort beschikbaar",
    soonSuffix: " — binnenkort beschikbaar",
    checkEmail: ["Controleer uw e-mails (", ") om uw account te bevestigen."] as [string, string],
    tooShort: `Het wachtwoord moet minstens ${MIN_PASSWORD_LENGTH} tekens bevatten.`,
    mismatch: "De twee wachtwoorden komen niet overeen.",
    invalidCredentials: "Onjuist e-mailadres of wachtwoord. Eerste aanmelding sinds de wijziging? Gebruik « Wachtwoord vergeten ».",
    exists: "Er bestaat al een account met dit e-mailadres — meld u aan.",
    weak: `Wachtwoord te zwak (minstens ${MIN_PASSWORD_LENGTH} tekens).`,
    same: "Het nieuwe wachtwoord moet verschillen van het oude.",
    rateLimit: "Te veel pogingen, probeer het over enkele minuten opnieuw.",
  },

  account: {
    signInTitle: "Aanmelden",
    signInLead: "Meld u aan of maak een account aan om uw sessies terug te vinden.",
    linkExpiredLead: "Deze link is verlopen of al gebruikt. Meld u opnieuw aan of vraag een nieuwe link aan.",
    forgotTitle: "Wachtwoord vergeten",
    forgotLead: "Geef uw e-mailadres op, dan sturen we u een link om een nieuw wachtwoord te kiezen.",
    forgotSent: ["Als er een account bestaat voor ", ", hebben we u een e-mail gestuurd met een link om een nieuw wachtwoord te kiezen."] as [string, string],
    sending: "Verzenden…",
    getLink: "Link ontvangen",
    expiredTitle: "Link verlopen",
    expiredLead: "Deze resetlink is niet meer geldig.",
    newLink: "Een nieuwe link aanvragen",
    resetTitle: "Nieuw wachtwoord",
    resetFor: ["Voor het account ", "."] as [string, string],
    newPassword: "Nieuw wachtwoord",
    saving: "Opslaan…",
    savePassword: "Wachtwoord opslaan",
    savedTitle: "Uw account is klaar",
    savedLead: "Uw resultaat is opgeslagen. U vindt het terug wanneer u zich de volgende keer aanmeldt.",
    seeSessions: "Mijn sessies bekijken",
    retake: "De test opnieuw afleggen",
  },

  dashboard: {
    signOut: "Afmelden",
    hello: "Hallo",
    lead: "Leg een nieuwe test af of bekijk uw vorige resultaten.",
    newTest: "Een nieuwe test afleggen",
    mySessions: "Mijn sessies",
    empty: "Nog geen sessies — start uw eerste test!",
    page: "Pagina",
    previous: "← Vorige",
    next: "Volgende →",
    back: "← Terug naar mijn sessies",
    duration: "Duur",
    fullRecording: "Volledige opname",
    noEvaluation: "Geen evaluatie opgeslagen voor deze sessie.",
    transcript: "Transcriptie",
    turn: (n: number) => `beurt ${n}`,
  },

  transcript: {
    title: "TRANSCRIPTIE",
    empty: "Het gesprek verschijnt hier…",
    you: "U",
  },
};

const es: UiStrings = {
  htmlLang: "es",
  sessionLength: ADAPTIVE ? "unos minutos" : `${MIN} minutos`,
  langName: { fr: "francés", en: "inglés", "nl-BE": "neerlandés", "nl-NL": "neerlandés", es: "español", it: "italiano", de: "alemán" },

  welcome: {
    eyebrow: "Evaluación oral · MCER",
    titleLine1: "Su nivel de idioma,",
    titleLine2: "en una conversación.",
    lead: (len, name) => `Hable en voz alta durante ${len} con ${name}, nuestra examinadora. Sus preguntas se adaptan a sus respuestas; no hay nada que preparar.`,
    steps: (name) => [
      ["Elija el idioma", "Francés, inglés, neerlandés, español, italiano o alemán."],
      [`Hable con ${name}`, "Una conversación de verdad, a su ritmo."],
      ["Reciba su nivel", "De A0 a C2, con el detalle: pronunciación, fluidez, vocabulario, gramática."],
    ],
    start: "Empezar",
    quietPlace: "Busque un lugar tranquilo y tenga un micrófono.",
    listen: "Escuchar esta página",
    stopListening: "Detener",
  },

  auth: {
    title: "Cree su cuenta",
    lead: "Para volver a ver sus resultados y seguir su progreso.",
    back: "← Volver",
    guest: "Continuar sin cuenta",
  },

  confirmPreference: {
    title: (lang, rung) => `¿Continuar en ${lang}, nivel ${rung}?`,
    lead: "Seguimos donde lo dejó.",
    continue: "Continuar",
    changeLanguage: "Cambiar de idioma",
  },

  language: {
    titleLine1: "Hola. ¿En qué idioma",
    titleLine2: "vamos a hablar?",
    lead: (len, name) => `Una conversación de ${len} con ${name}, nuestra examinadora. No hay nada que preparar.`,
    continueIn: (lang) => `Continuar en ${lang}`,
    micNext: "Podrá comprobar su micrófono en el paso siguiente.",
  },

  instructions: {
    topBarSuffix: "· evaluación oral",
    changeLanguageAria: "Cambiar de idioma",
    title: (len) => `Su nivel en ${len}`,
    lead: (name) => `${name} le hará preguntas sencillas sobre su vida diaria. Responda en voz alta, como en una conversación real.`,
    steps: (name) => [
      ["Escuche la pregunta", "Puede pedir que la repita una vez."],
      ["Hable con libertad", "Dudar, volver a empezar, corregirse: todo eso es normal."],
      ["Deje un silencio", `${name} entiende que ha terminado y continúa.`],
    ],
    integrityStep: ["Responda con espontaneidad", "Sin ayuda externa. Los silencios largos antes de responder y las salidas de esta ventana se registran y el evaluador puede verlos."],
    micLabel: "SU MICRÓFONO",
    micBlocked: "El micrófono está bloqueado — permita el acceso en los ajustes del navegador.",
    sayHello: "Diga «hola» para comprobar que le oímos bien.",
    noisy: "Su entorno parece un poco ruidoso. La prueba funcionará, pero sus resultados serán más fiables en un lugar más tranquilo.",
    quiet: "Le oímos débilmente. Acérquese al micrófono o hable un poco más alto.",
    micDetected: (label) => `Micrófono detectado — ${label}`,
    micNotDetected: "Micrófono no detectado",
    micDetecting: "Detectando el micrófono…",
    defaultMic: "Micrófono predeterminado",
    ready: "Estoy listo",
    noGrades: "No se muestra ninguna nota durante la prueba.",
  },

  session: {
    answers: (n) => `${n} respuesta${n === 1 ? "" : "s"}`,
    answersAria: (n) => `${n} respuesta${n === 1 ? "" : "s"} dada${n === 1 ? "" : "s"}`,
    finish: "Terminar",
    awayNotice: "Por favor, permanezca en la prueba y no salga de esta ventana.",
    avatarSpeaking: (name) => `${name} le está hablando`,
    listenThen: "Escuche — responderá justo después.",
    yourTurn: "Su turno — le escuchamos",
    finishedTitle: (name) => `He terminado — si ${name} no reacciona al final de su respuesta`,
    finishedAria: "He terminado",
    repeat: "Repetir la pregunta",
    notUnderstood: "No lo entiendo",
    skip: "Saltar",
    confirmSkip: "¿Saltar esta pregunta sin responder?",
    thinking: (name) => `${name} prepara la siguiente pregunta`,
    doingWell: "Lo está haciendo bien.",
    micInterrupted: "La sesión se ha interrumpido: el micrófono se cortó mientras la pantalla estaba bloqueada o la aplicación en segundo plano.",
    finishAndSee: "Terminar y ver mi resultado",
    notHeard: "No le he oído bien — ¿puede repetirlo?",
    examinerError: "La examinadora tiene un problema técnico, vuelva a intentarlo en un momento.",
  },

  evaluating: {
    labels: ["ANÁLISIS EN CURSO", "ANALIZANDO LA PRONUNCIACIÓN", "ANALIZANDO EL VOCABULARIO", "ANALIZANDO LA GRAMÁTICA"],
    title: "Ha terminado, gracias.",
    lead: "Estamos analizando su expresión oral: pronunciación, fluidez, vocabulario y gramática. Su nivel MCER aparecerá en un momento.",
    done: "TERMINADO",
    canClose: "Puede cerrar esta ventana: le enviaremos el informe por correo electrónico.",
  },

  results: {
    newSession: "Nueva sesión",
    thanks: "Gracias por hacer la prueba.",
    hereIsResult: "Este es su resultado.",
    evalFailed: "No se ha podido completar la evaluación, pero su sesión se ha guardado.",
    detailToggle: "Ver el detalle: grabación y transcripción",
    listen: "ESCUCHAR",
    coloredWords: "Las palabras en color de la transcripción indican la calidad de su pronunciación.",
  },

  cefr: {
    eyebrow: "SU NIVEL",
    score: "Puntuación",
    strengths: "Puntos fuertes",
    toImprove: "A mejorar",
    notableErrors: "Errores destacados",
    confidence: {
      high: "FIABLE",
      medium: "MEDIO",
      low: "ORIENTATIVO",
    },
    topOfScale: "El nivel más alto que evalúa esta prueba. Su expresión oral está en lo más alto de nuestra escala; quizá su nivel sea aún superior (C2), algo que esta breve conversación no está pensada para medir.",
    axes: {
      pronunciation: "Pronunciación",
      fluency: "Fluidez",
      vocabGram: "Vocab. y gram.",
      communication: "Comunicación",
    },
    notAvailable: "n/d",
  },

  survey: {
    aria: "Su opinión",
    questions: ["En una escala del 1 al 10, ¿le ha gustado la experiencia?", "¿Le han parecido pertinentes las preguntas?", "¿Le parece acertado el nivel obtenido?"],
    thanks: "¡Gracias por su opinión!",
    title: "Nos interesa su opinión",
    scale: "Tres preguntas rápidas (1 = nada, 10 = totalmente).",
    comment: "¿Algún comentario? (opcional)",
    failed: "No se ha podido enviar. Puede volver a intentarlo u omitirlo.",
    skip: "Omitir",
    sending: "Enviando…",
    send: "Enviar",
  },

  claim: {
    title: "¿Quiere conservar este resultado?",
    lead: "Cree una cuenta (o inicie sesión) para encontrarlo más tarde.",
  },

  nav: {
    interfaceLanguage: "Idioma de la interfaz",
    mySessions: "Mis sesiones",
    signIn: "Iniciar sesión",
  },

  authForm: {
    signIn: "Iniciar sesión",
    signUp: "Crear una cuenta",
    submitSignUp: "Crear mi cuenta",
    busy: "Un momento…",
    emailPlaceholder: "usted@ejemplo.com",
    password: "Contraseña",
    confirmPassword: "Confirmar la contraseña",
    forgot: "¿Ha olvidado su contraseña?",
    or: "o",
    google: "Continuar con Google",
    soon: "Próximamente",
    soonSuffix: " — próximamente",
    checkEmail: ["Revise su correo (", ") para confirmar su cuenta."] as [string, string],
    tooShort: `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`,
    mismatch: "Las dos contraseñas no coinciden.",
    invalidCredentials: "Correo o contraseña incorrectos. ¿Primera conexión desde el cambio? Use «¿Ha olvidado su contraseña?».",
    exists: "Ya existe una cuenta con este correo — inicie sesión.",
    weak: `Contraseña demasiado débil (al menos ${MIN_PASSWORD_LENGTH} caracteres).`,
    same: "La nueva contraseña debe ser distinta de la anterior.",
    rateLimit: "Demasiados intentos, vuelva a intentarlo en unos minutos.",
  },

  account: {
    signInTitle: "Iniciar sesión",
    signInLead: "Inicie sesión o cree una cuenta para encontrar sus sesiones.",
    linkExpiredLead: "Este enlace ha caducado o ya se ha utilizado. Vuelva a iniciar sesión o pida un enlace nuevo.",
    forgotTitle: "Contraseña olvidada",
    forgotLead: "Indique su correo y le enviaremos un enlace para elegir una nueva.",
    forgotSent: ["Si existe una cuenta para ", ", le hemos enviado un correo con un enlace para elegir una nueva contraseña."] as [string, string],
    sending: "Enviando…",
    getLink: "Recibir el enlace",
    expiredTitle: "Enlace caducado",
    expiredLead: "Este enlace de restablecimiento ya no es válido.",
    newLink: "Pedir un enlace nuevo",
    resetTitle: "Nueva contraseña",
    resetFor: ["Para la cuenta ", "."] as [string, string],
    newPassword: "Nueva contraseña",
    saving: "Guardando…",
    savePassword: "Guardar la contraseña",
    savedTitle: "Su cuenta está lista",
    savedLead: "Su resultado se ha guardado. Lo encontrará la próxima vez que inicie sesión.",
    seeSessions: "Ver mis sesiones",
    retake: "Volver a hacer la prueba",
  },

  dashboard: {
    signOut: "Cerrar sesión",
    hello: "Hola",
    lead: "Haga una nueva prueba o consulte sus resultados anteriores.",
    newTest: "Hacer una nueva prueba",
    mySessions: "Mis sesiones",
    empty: "Todavía no hay sesiones — ¡empiece su primera prueba!",
    page: "Página",
    previous: "← Anterior",
    next: "Siguiente →",
    back: "← Volver a mis sesiones",
    duration: "Duración",
    fullRecording: "Grabación completa",
    noEvaluation: "No hay ninguna evaluación guardada para esta sesión.",
    transcript: "Transcripción",
    turn: (n: number) => `turno ${n}`,
  },

  transcript: {
    title: "TRANSCRIPCIÓN",
    empty: "La conversación aparecerá aquí…",
    you: "Usted",
  },
};

const it: UiStrings = {
  htmlLang: "it",
  sessionLength: ADAPTIVE ? "qualche minuto" : `${MIN} minuti`,
  langName: { fr: "francese", en: "inglese", "nl-BE": "neerlandese", "nl-NL": "neerlandese", es: "spagnolo", it: "italiano", de: "tedesco" },

  welcome: {
    eyebrow: "Valutazione orale · QCER",
    titleLine1: "Il suo livello di lingua,",
    titleLine2: "in una conversazione.",
    lead: (len, name) => `Parli ad alta voce per ${len} con ${name}, la nostra esaminatrice. Le sue domande si adattano alle sue risposte; non c'è niente da preparare.`,
    steps: (name) => [
      ["Scelga la lingua", "Francese, inglese, neerlandese, spagnolo, italiano o tedesco."],
      [`Parli con ${name}`, "Una vera conversazione, al ritmo che preferisce."],
      ["Riceva il suo livello", "Da A0 a C2, con il dettaglio: pronuncia, scioltezza, lessico, grammatica."],
    ],
    start: "Inizia",
    quietPlace: "Serve un posto tranquillo e un microfono.",
    listen: "Ascolta questa pagina",
    stopListening: "Interrompi",
  },

  auth: {
    title: "Crei il suo account",
    lead: "Per ritrovare i suoi risultati e seguire i suoi progressi.",
    back: "← Indietro",
    guest: "Continua senza account",
  },

  confirmPreference: {
    title: (lang, rung) => `Continuare in ${lang}, livello ${rung}?`,
    lead: "Riprendiamo da dove si era fermato/a.",
    continue: "Continua",
    changeLanguage: "Cambia lingua",
  },

  language: {
    titleLine1: "Buongiorno. In che lingua",
    titleLine2: "parliamo?",
    lead: (len, name) => `Una conversazione di ${len} con ${name}, la nostra esaminatrice. Non c'è niente da preparare.`,
    continueIn: (lang) => `Continua in ${lang}`,
    micNext: "Potrà verificare il microfono al passaggio successivo.",
  },

  instructions: {
    topBarSuffix: "· valutazione orale",
    changeLanguageAria: "Cambia lingua",
    title: (len) => `Il suo livello in ${len}`,
    lead: (name) => `${name} le farà domande semplici sulla sua vita quotidiana. Risponda ad alta voce, come in una vera conversazione.`,
    steps: (name) => [
      ["Ascolti la domanda", "Può farla ripetere una volta."],
      ["Parli liberamente", "Esitare, ricominciare, correggersi: è tutto normale."],
      ["Lasci un silenzio", `${name} capisce che ha finito e prosegue.`],
    ],
    integrityStep: ["Risponda spontaneamente", "Senza aiuti esterni. I lunghi silenzi prima di rispondere e le uscite da questa finestra vengono registrati e sono visibili al valutatore."],
    micLabel: "IL SUO MICROFONO",
    micBlocked: "Il microfono è bloccato — consenta l'accesso nelle impostazioni del browser.",
    sayHello: "Dica «buongiorno» per verificare che la sentiamo bene.",
    noisy: "L'ambiente sembra un po' rumoroso. Il test funzionerà, ma i risultati saranno più affidabili in un posto più tranquillo.",
    quiet: "La sentiamo debolmente. Si avvicini al microfono o parli un po' più forte.",
    micDetected: (label) => `Microfono rilevato — ${label}`,
    micNotDetected: "Microfono non rilevato",
    micDetecting: "Rilevamento del microfono…",
    defaultMic: "Microfono predefinito",
    ready: "Sono pronto",
    noGrades: "Durante la prova non viene mostrato alcun voto.",
  },

  session: {
    answers: (n) => `${n} rispost${n === 1 ? "a" : "e"}`,
    answersAria: (n) => `${n} rispost${n === 1 ? "a data" : "e date"}`,
    finish: "Termina",
    awayNotice: "La preghiamo di restare sul test e di non lasciare questa finestra.",
    avatarSpeaking: (name) => `${name} le sta parlando`,
    listenThen: "Ascolti — risponderà subito dopo.",
    yourTurn: "Tocca a lei — la ascoltiamo",
    finishedTitle: (name) => `Ho finito — se ${name} non reagisce alla fine della sua risposta`,
    finishedAria: "Ho finito",
    repeat: "Ripeti la domanda",
    notUnderstood: "Non capisco",
    skip: "Salta",
    confirmSkip: "Saltare questa domanda senza rispondere?",
    thinking: (name) => `${name} prepara la prossima domanda`,
    doingWell: "Sta andando bene.",
    micInterrupted: "La sessione è stata interrotta: il microfono si è spento mentre lo schermo era bloccato o l'app in background.",
    finishAndSee: "Termina e vedi il mio risultato",
    notHeard: "Non ho sentito bene — può ripetere?",
    examinerError: "L'esaminatrice ha un problema tecnico, riprovi tra un momento.",
  },

  evaluating: {
    labels: ["ANALISI IN CORSO", "ANALISI DELLA PRONUNCIA", "ANALISI DEL LESSICO", "ANALISI DELLA GRAMMATICA"],
    title: "Abbiamo finito, grazie.",
    lead: "Stiamo analizzando la sua produzione orale: pronuncia, scioltezza, lessico e grammatica. Il suo livello QCER apparirà tra un istante.",
    done: "FATTO",
    canClose: "Può chiudere questa finestra: il rapporto le sarà inviato per e-mail.",
  },

  results: {
    newSession: "Nuova sessione",
    thanks: "Grazie per aver fatto il test.",
    hereIsResult: "Ecco il suo risultato.",
    evalFailed: "Non è stato possibile completare la valutazione, ma la sua sessione è stata salvata.",
    detailToggle: "Vedi il dettaglio: registrazione e trascrizione",
    listen: "ASCOLTA",
    coloredWords: "Le parole colorate nella trascrizione qui sotto indicano la qualità della pronuncia.",
  },

  cefr: {
    eyebrow: "IL SUO LIVELLO",
    score: "Punteggio",
    strengths: "Punti di forza",
    toImprove: "Da migliorare",
    notableErrors: "Errori rilevanti",
    confidence: {
      high: "AFFIDABILE",
      medium: "MEDIO",
      low: "INDICATIVO",
    },
    topOfScale: "Il livello più alto valutato da questo test. La sua espressione orale è in cima alla nostra scala; il suo livello potrebbe essere ancora più alto (C2), cosa che questa breve conversazione non è pensata per misurare.",
    axes: {
      pronunciation: "Pronuncia",
      fluency: "Scioltezza",
      vocabGram: "Lessico e gramm.",
      communication: "Comunicazione",
    },
    notAvailable: "n.d.",
  },

  survey: {
    aria: "La sua opinione",
    questions: ["Su una scala da 1 a 10, le è piaciuta l'esperienza?", "Le domande le sono sembrate pertinenti?", "Il livello ottenuto le sembra corretto?"],
    thanks: "Grazie per il suo riscontro!",
    title: "La sua opinione ci interessa",
    scale: "Tre domande veloci (1 = per niente, 10 = del tutto).",
    comment: "Un commento? (facoltativo)",
    failed: "Invio non riuscito. Può riprovare o saltare.",
    skip: "Salta",
    sending: "Invio…",
    send: "Invia",
  },

  claim: {
    title: "Vuole conservare questo risultato?",
    lead: "Crei un account (o acceda) per ritrovarlo più tardi.",
  },

  nav: {
    interfaceLanguage: "Lingua dell'interfaccia",
    mySessions: "Le mie sessioni",
    signIn: "Accedi",
  },

  authForm: {
    signIn: "Accedi",
    signUp: "Crea un account",
    submitSignUp: "Crea il mio account",
    busy: "Un attimo…",
    emailPlaceholder: "lei@esempio.it",
    password: "Password",
    confirmPassword: "Conferma la password",
    forgot: "Password dimenticata?",
    or: "oppure",
    google: "Continua con Google",
    soon: "Presto disponibile",
    soonSuffix: " — presto disponibile",
    checkEmail: ["Controlli le sue e-mail (", ") per confermare l'account."] as [string, string],
    tooShort: `La password deve contenere almeno ${MIN_PASSWORD_LENGTH} caratteri.`,
    mismatch: "Le due password non coincidono.",
    invalidCredentials: "E-mail o password errate. Primo accesso dopo il cambiamento? Usi «Password dimenticata».",
    exists: "Esiste già un account con questa e-mail — acceda.",
    weak: `Password troppo debole (almeno ${MIN_PASSWORD_LENGTH} caratteri).`,
    same: "La nuova password deve essere diversa dalla precedente.",
    rateLimit: "Troppi tentativi, riprovi tra qualche minuto.",
  },

  account: {
    signInTitle: "Accedi",
    signInLead: "Acceda o crei un account per ritrovare le sue sessioni.",
    linkExpiredLead: "Questo link è scaduto o è già stato usato. Acceda di nuovo o richieda un nuovo link.",
    forgotTitle: "Password dimenticata",
    forgotLead: "Indichi la sua e-mail: le invieremo un link per sceglierne una nuova.",
    forgotSent: ["Se esiste un account per ", ", le abbiamo inviato un'e-mail con un link per scegliere una nuova password."] as [string, string],
    sending: "Invio…",
    getLink: "Ricevi il link",
    expiredTitle: "Link scaduto",
    expiredLead: "Questo link di reimpostazione non è più valido.",
    newLink: "Richiedi un nuovo link",
    resetTitle: "Nuova password",
    resetFor: ["Per l'account ", "."] as [string, string],
    newPassword: "Nuova password",
    saving: "Salvataggio…",
    savePassword: "Salva la password",
    savedTitle: "Il suo account è pronto",
    savedLead: "Il suo risultato è stato salvato. Lo ritroverà al prossimo accesso.",
    seeSessions: "Vedi le mie sessioni",
    retake: "Rifai il test",
  },

  dashboard: {
    signOut: "Esci",
    hello: "Buongiorno",
    lead: "Faccia un nuovo test o ritrovi i suoi risultati precedenti.",
    newTest: "Fai un nuovo test",
    mySessions: "Le mie sessioni",
    empty: "Ancora nessuna sessione — inizi il suo primo test!",
    page: "Pagina",
    previous: "← Precedente",
    next: "Successiva →",
    back: "← Torna alle mie sessioni",
    duration: "Durata",
    fullRecording: "Registrazione completa",
    noEvaluation: "Nessuna valutazione salvata per questa sessione.",
    transcript: "Trascrizione",
    turn: (n: number) => `turno ${n}`,
  },

  transcript: {
    title: "TRASCRIZIONE",
    empty: "La conversazione apparirà qui…",
    you: "Lei",
  },
};

const de: UiStrings = {
  htmlLang: "de",
  /** Dative: reads after "in" / "von". */
  sessionLength: ADAPTIVE ? "wenigen Minuten" : `${MIN} Minuten`,
  langName: { fr: "Französisch", en: "Englisch", "nl-BE": "Niederländisch", "nl-NL": "Niederländisch", es: "Spanisch", it: "Italienisch", de: "Deutsch" },

  welcome: {
    eyebrow: "Mündliche Prüfung · GER",
    titleLine1: "Ihr Sprachniveau,",
    titleLine2: "in einem Gespräch.",
    lead: (len, name) => `Ein Gespräch von ${len}, laut gesprochen, mit ${name}, unserer Prüferin. Ihre Fragen passen sich Ihren Antworten an; Sie müssen nichts vorbereiten.`,
    steps: (name) => [
      ["Wählen Sie die Sprache", "Französisch, Englisch, Niederländisch, Spanisch, Italienisch oder Deutsch."],
      [`Sprechen Sie mit ${name}`, "Ein echtes Gespräch, in Ihrem Tempo."],
      ["Erhalten Sie Ihr Niveau", "Von A0 bis C2, im Detail: Aussprache, Flüssigkeit, Wortschatz, Grammatik."],
    ],
    start: "Starten",
    quietPlace: "Sie brauchen einen ruhigen Ort und ein Mikrofon.",
    listen: "Diese Seite anhören",
    stopListening: "Anhalten",
  },

  auth: {
    title: "Erstellen Sie Ihr Konto",
    lead: "Um Ihre Ergebnisse wiederzufinden und Ihre Fortschritte zu verfolgen.",
    back: "← Zurück",
    guest: "Ohne Konto fortfahren",
  },

  confirmPreference: {
    title: (lang, rung) => `Weiter auf ${lang}, Niveau ${rung}?`,
    lead: "Wir machen dort weiter, wo Sie aufgehört haben.",
    continue: "Weiter",
    changeLanguage: "Sprache ändern",
  },

  language: {
    titleLine1: "Guten Tag. In welcher Sprache",
    titleLine2: "sprechen wir?",
    lead: (len, name) => `Ein Gespräch von ${len} mit ${name}, unserer Prüferin. Sie müssen nichts vorbereiten.`,
    continueIn: (lang) => `Weiter auf ${lang}`,
    micNext: "Im nächsten Schritt können Sie Ihr Mikrofon prüfen.",
  },

  instructions: {
    topBarSuffix: "· mündliche Prüfung",
    changeLanguageAria: "Sprache ändern",
    title: (len) => `Ihr Niveau in ${len}`,
    lead: (name) => `${name} stellt Ihnen einfache Fragen zu Ihrem Alltag. Antworten Sie laut, wie in einem echten Gespräch.`,
    steps: (name) => [
      ["Hören Sie die Frage", "Sie können sie einmal wiederholen lassen."],
      ["Sprechen Sie frei", "Zögern, neu ansetzen, sich korrigieren: All das ist normal."],
      ["Lassen Sie eine Pause", `${name} versteht, dass Sie fertig sind, und macht weiter.`],
    ],
    integrityStep: ["Antworten Sie spontan", "Ohne fremde Hilfe. Lange Pausen vor dem Antworten und das Verlassen dieses Fensters werden aufgezeichnet und sind für den Prüfer sichtbar."],
    micLabel: "IHR MIKROFON",
    micBlocked: "Das Mikrofon ist blockiert — erlauben Sie den Zugriff in den Browsereinstellungen.",
    sayHello: "Sagen Sie „Hallo“, um zu prüfen, ob wir Sie gut hören.",
    noisy: "Ihre Umgebung scheint etwas laut zu sein. Der Test funktioniert, aber an einem ruhigeren Ort werden Ihre Ergebnisse zuverlässiger.",
    quiet: "Wir hören Sie nur leise. Gehen Sie näher ans Mikrofon oder sprechen Sie etwas lauter.",
    micDetected: (label) => `Mikrofon erkannt — ${label}`,
    micNotDetected: "Kein Mikrofon erkannt",
    micDetecting: "Mikrofon wird gesucht…",
    defaultMic: "Standardmikrofon",
    ready: "Ich bin bereit",
    noGrades: "Während der Prüfung werden keine Noten angezeigt.",
  },

  session: {
    answers: (n) => `${n} Antwort${n === 1 ? "" : "en"}`,
    answersAria: (n) => `${n} Antwort${n === 1 ? "" : "en"} gegeben`,
    finish: "Beenden",
    awayNotice: "Bitte bleiben Sie beim Test und verlassen Sie dieses Fenster nicht.",
    avatarSpeaking: (name) => `${name} spricht`,
    listenThen: "Hören Sie zu — Sie antworten gleich danach.",
    yourTurn: "Sie sind dran — wir hören zu",
    finishedTitle: (name) => `Ich bin fertig — falls ${name} am Ende Ihrer Antwort nicht reagiert`,
    finishedAria: "Ich bin fertig",
    repeat: "Frage wiederholen",
    notUnderstood: "Ich verstehe nicht",
    skip: "Überspringen",
    confirmSkip: "Diese Frage überspringen, ohne zu antworten?",
    thinking: (name) => `${name} bereitet die nächste Frage vor`,
    doingWell: "Sie machen das gut.",
    micInterrupted: "Die Sitzung wurde unterbrochen: Das Mikrofon ging aus, während der Bildschirm gesperrt oder die App im Hintergrund war.",
    finishAndSee: "Beenden und mein Ergebnis ansehen",
    notHeard: "Ich habe Sie nicht gut gehört — können Sie das wiederholen?",
    examinerError: "Die Prüferin hat ein technisches Problem, bitte versuchen Sie es gleich noch einmal.",
  },

  evaluating: {
    labels: ["ANALYSE LÄUFT", "AUSSPRACHE WIRD ANALYSIERT", "WORTSCHATZ WIRD ANALYSIERT", "GRAMMATIK WIRD ANALYSIERT"],
    title: "Geschafft, vielen Dank.",
    lead: "Wir analysieren Ihre mündliche Leistung: Aussprache, Flüssigkeit, Wortschatz und Grammatik. Ihr GER-Niveau erscheint gleich.",
    done: "FERTIG",
    canClose: "Sie können dieses Fenster schließen: Der Bericht wird Ihnen per E-Mail zugeschickt.",
  },

  results: {
    newSession: "Neue Sitzung",
    thanks: "Danke, dass Sie den Test gemacht haben.",
    hereIsResult: "Hier ist Ihr Ergebnis.",
    evalFailed: "Die Auswertung konnte nicht abgeschlossen werden, aber Ihre Sitzung wurde gespeichert.",
    detailToggle: "Details ansehen: Aufnahme und Transkript",
    listen: "ANHÖREN",
    coloredWords: "Die farbigen Wörter im Transkript unten zeigen die Qualität Ihrer Aussprache.",
  },

  cefr: {
    eyebrow: "IHR NIVEAU",
    score: "Punktzahl",
    strengths: "Stärken",
    toImprove: "Daran arbeiten",
    notableErrors: "Auffällige Fehler",
    confidence: {
      high: "ZUVERLÄSSIG",
      medium: "MITTEL",
      low: "RICHTWERT",
    },
    topOfScale: "Das höchste Niveau, das dieser Test misst. Ihr mündlicher Ausdruck liegt ganz oben auf unserer Skala; Ihr Niveau ist vielleicht noch höher (C2), was dieses kurze Gespräch nicht messen soll.",
    axes: {
      pronunciation: "Aussprache",
      fluency: "Flüssigkeit",
      vocabGram: "Wortsch. & Gramm.",
      communication: "Kommunikation",
    },
    notAvailable: "k. A.",
  },

  survey: {
    aria: "Ihre Meinung",
    questions: ["Wie hat Ihnen die Erfahrung auf einer Skala von 1 bis 10 gefallen?", "Fanden Sie die Fragen passend?", "Erscheint Ihnen das erreichte Niveau zutreffend?"],
    thanks: "Danke für Ihre Rückmeldung!",
    title: "Ihre Meinung ist uns wichtig",
    scale: "Drei kurze Fragen (1 = gar nicht, 10 = voll und ganz).",
    comment: "Ein Kommentar? (optional)",
    failed: "Senden fehlgeschlagen. Sie können es erneut versuchen oder überspringen.",
    skip: "Überspringen",
    sending: "Wird gesendet…",
    send: "Senden",
  },

  claim: {
    title: "Möchten Sie dieses Ergebnis behalten?",
    lead: "Erstellen Sie ein Konto (oder melden Sie sich an), um es später wiederzufinden.",
  },

  nav: {
    interfaceLanguage: "Sprache der Oberfläche",
    mySessions: "Meine Sitzungen",
    signIn: "Anmelden",
  },

  authForm: {
    signIn: "Anmelden",
    signUp: "Konto erstellen",
    submitSignUp: "Mein Konto erstellen",
    busy: "Einen Moment…",
    emailPlaceholder: "sie@beispiel.de",
    password: "Passwort",
    confirmPassword: "Passwort bestätigen",
    forgot: "Passwort vergessen?",
    or: "oder",
    google: "Weiter mit Google",
    soon: "Demnächst verfügbar",
    soonSuffix: " — demnächst verfügbar",
    checkEmail: ["Prüfen Sie Ihre E-Mails (", "), um Ihr Konto zu bestätigen."] as [string, string],
    tooShort: `Das Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen lang sein.`,
    mismatch: "Die beiden Passwörter stimmen nicht überein.",
    invalidCredentials: "E-Mail oder Passwort falsch. Erste Anmeldung seit der Umstellung? Nutzen Sie „Passwort vergessen“.",
    exists: "Mit dieser E-Mail gibt es bereits ein Konto — melden Sie sich an.",
    weak: `Passwort zu schwach (mindestens ${MIN_PASSWORD_LENGTH} Zeichen).`,
    same: "Das neue Passwort muss sich vom alten unterscheiden.",
    rateLimit: "Zu viele Versuche, versuchen Sie es in ein paar Minuten erneut.",
  },

  account: {
    signInTitle: "Anmelden",
    signInLead: "Melden Sie sich an oder erstellen Sie ein Konto, um Ihre Sitzungen wiederzufinden.",
    linkExpiredLead: "Dieser Link ist abgelaufen oder wurde bereits verwendet. Melden Sie sich erneut an oder fordern Sie einen neuen Link an.",
    forgotTitle: "Passwort vergessen",
    forgotLead: "Geben Sie Ihre E-Mail-Adresse ein, wir senden Ihnen einen Link, um ein neues zu wählen.",
    forgotSent: ["Falls ein Konto für ", " existiert, haben wir Ihnen eine E-Mail mit einem Link zum Wählen eines neuen Passworts geschickt."] as [string, string],
    sending: "Wird gesendet…",
    getLink: "Link erhalten",
    expiredTitle: "Link abgelaufen",
    expiredLead: "Dieser Link zum Zurücksetzen ist nicht mehr gültig.",
    newLink: "Neuen Link anfordern",
    resetTitle: "Neues Passwort",
    resetFor: ["Für das Konto ", "."] as [string, string],
    newPassword: "Neues Passwort",
    saving: "Wird gespeichert…",
    savePassword: "Passwort speichern",
    savedTitle: "Ihr Konto ist bereit",
    savedLead: "Ihr Ergebnis wurde gespeichert. Sie finden es bei Ihrer nächsten Anmeldung wieder.",
    seeSessions: "Meine Sitzungen ansehen",
    retake: "Test erneut machen",
  },

  dashboard: {
    signOut: "Abmelden",
    hello: "Guten Tag",
    lead: "Machen Sie einen neuen Test oder sehen Sie sich Ihre früheren Ergebnisse an.",
    newTest: "Neuen Test machen",
    mySessions: "Meine Sitzungen",
    empty: "Noch keine Sitzungen — starten Sie Ihren ersten Test!",
    page: "Seite",
    previous: "← Zurück",
    next: "Weiter →",
    back: "← Zurück zu meinen Sitzungen",
    duration: "Dauer",
    fullRecording: "Vollständige Aufnahme",
    noEvaluation: "Für diese Sitzung ist keine Auswertung gespeichert.",
    transcript: "Transkript",
    turn: (n: number) => `Runde ${n}`,
  },

  transcript: {
    title: "TRANSKRIPT",
    empty: "Das Gespräch erscheint hier…",
    you: "Sie",
  },
};

export const UI_STRINGS: Record<UiLang, UiStrings> = { fr, en, nl, es, it, de };
