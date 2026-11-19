/** The JSON object in a model reply (tolerates a ```json fence or text around it), or null. */
export function parseJsonObject(raw: string): Record<string, unknown> | null {
  const candidates = [raw.trim(), raw.replace(/^```(?:json)?\s*|\s*```$/g, "").trim()];
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) candidates.push(raw.slice(start, end + 1));
  for (const c of candidates) {
    try {
      const v = JSON.parse(c);
      if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch {
      // try the next form
    }
  }
  return null;
}
