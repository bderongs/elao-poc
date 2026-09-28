/**
 * Non-comprehension detection — spots a SHORT answer whose whole point is
 * "I didn't understand / I can't say that / say it again", so the examiner
 * rephrases the same question more simply instead of logging a neutral pivot
 * ("Entendido.") and firing an equally hard new question. Seen live on a
 * near-beginner Spanish session: five "no comprendo / no hablo español"
 * answers in a row, each met with a brand-new question.
 *
 * Deliberately a plain pattern match, not an LLM call: it has to be known
 * BEFORE /api/chat fires (ET runs in parallel and is never awaited), and the
 * phrases are formulaic. Patterns cover every assessment language plus
 * French and English, which learners fall back on when stuck. Anything the
 * patterns miss is still caught, less reliably, by the COMPREHENSION rule in
 * lib/conversation-prompts.ts.
 *
 * Pure string helpers only — safe to import from both client and server code.
 */

/** Longer answers that merely CONTAIN a phrase ("no entiendo por qué la gente…") are real content, not a request for help. */
const MAX_WORDS = 14;

// Matched against lowercased, accent-stripped text with apostrophes removed
// ("je n'ai pas compris" → "je nai pas compris"), so no accents below.
const PATTERNS: RegExp[] = [
  // Spanish
  /\bno (lo |le |te )?(entiendo|entendi|comprendo|comprendi|he entendido|he comprendido)\b/,
  /\bno (hablo|puedo hablar|puede hablar|se hablar)\b/,
  /\b(muy|demasiado) (complicad|dificil)/,
  /\b(puede|puedes|podria|podrias) repetir/,
  /\bmas despacio\b/,
  // French
  /\bje (ne )?comprends? pas\b/,
  /\b(je nai|jai) pas compris\b/,
  /\bje (ne )?parle pas\b/,
  /\btrop (complique|difficile|dur)\b/,
  /\b(pouvez|peux)[- ]?(vous|tu) repeter\b/,
  /\bplus lentement\b/,
  // English
  /\bi (dont|do not|didnt|did not) (understand|get it|speak)\b/,
  /\b(can|could) you (repeat|say that again)\b/,
  /\btoo (hard|difficult|complicated)\b/,
  /\b(more )?slowly please\b/,
  // Italian
  /\bnon (capisco|ho capito|parlo)\b/,
  /\b(troppo|molto) (difficile|complicat)/,
  /\b(puo|puoi) ripetere\b/,
  /\bpiu (piano|lentamente)\b/,
  // German
  /\b(ich )?verstehe (das |es |sie )?nicht\b/,
  /\bnicht verstanden\b/,
  /\bich spreche (kein|nicht)\b/,
  /\bzu (schwer|schwierig|kompliziert)\b/,
  /\bwiederholen\b/,
  /\blangsamer\b/,
  // Dutch
  /\b(ik )?(begrijp|snap) (het |dat |u |je )?niet\b/,
  /\bniet (begrepen|verstaan)\b/,
  /\bik spreek (geen|niet)\b/,
  /\bte (moeilijk|ingewikkeld)\b/,
  /\bherhalen\b/,
  /\b(trager|langzamer)\b/,
];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’'`]/g, "")
    .replace(/[¿¡?!.,;:«»"]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when a short user answer is essentially "I didn't understand / can't answer that / repeat please". */
export function isNonComprehension(text: string): boolean {
  const normalized = normalize(text);
  if (!normalized) return false;
  if (normalized.split(" ").length > MAX_WORDS) return false;
  return PATTERNS.some((p) => p.test(normalized));
}
