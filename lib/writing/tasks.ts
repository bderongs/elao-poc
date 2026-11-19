/**
 * The three productions of the written test — PROVISIONAL, the same for
 * every candidate (client's choice for the MVP), from a practical message to
 * an argued opinion. Instructions are in the tested language. The `points`
 * are what "adéquation à la tâche" is checked against: keep them in line
 * with the instructions.
 */
import type { WritingLang, WritingTask } from "./types";

export const WRITING_TASKS: Record<WritingLang, WritingTask[]> = {
  fr: [
    {
      id: "message",
      title: "Un message à un ami",
      instructions:
        "Vous aviez prévu de voir un ami samedi, mais vous ne pouvez plus venir. Écrivez-lui un message : excusez-vous, expliquez pourquoi vous ne pouvez pas venir et proposez une autre date.",
      points: ["S'excuser", "Expliquer pourquoi la personne ne peut pas venir", "Proposer une autre date"],
    },
    {
      id: "recit",
      title: "Un souvenir",
      instructions:
        "Racontez un voyage, une sortie ou une journée qui ne s'est pas passé comme prévu. Dites ce qui s'est passé, comment vous avez réagi et ce que vous en retenez aujourd'hui.",
      points: ["Raconter ce qui s'est passé", "Dire comment la personne a réagi", "Dire ce qu'elle en retient aujourd'hui"],
    },
    {
      id: "opinion",
      title: "Votre avis",
      instructions:
        "« Le télétravail devrait devenir la norme pour tous les métiers qui le permettent. » Êtes-vous d'accord ? Donnez votre avis avec au moins un argument et un exemple, puis évoquez un point de vue différent du vôtre.",
      points: ["Donner son avis sur l'affirmation", "Appuyer cet avis par un argument et un exemple", "Évoquer un point de vue différent"],
    },
  ],
  en: [
    {
      id: "message",
      title: "A message to a friend",
      instructions:
        "You had planned to meet a friend on Saturday, but you can no longer come. Write them a message: apologise, explain why you cannot come, and suggest another date.",
      points: ["Apologise", "Explain why they cannot come", "Suggest another date"],
    },
    {
      id: "story",
      title: "A memory",
      instructions:
        "Tell the story of a trip, an outing or a day that did not go as planned. Say what happened, how you reacted, and what you take away from it today.",
      points: ["Tell what happened", "Say how they reacted", "Say what they take away from it today"],
    },
    {
      id: "opinion",
      title: "Your opinion",
      instructions:
        "\"Remote work should become the norm for every job that allows it.\" Do you agree? Give your opinion with at least one argument and one example, then mention a point of view different from yours.",
      points: ["Give an opinion on the statement", "Support it with an argument and an example", "Mention a different point of view"],
    },
  ],
};

/** Words as the candidate sees them counted: runs of letters/digits, apostrophes and hyphens kept inside words ("aujourd'hui", "rendez-vous" = 1). */
export function countWords(text: string): number {
  return text.match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}
