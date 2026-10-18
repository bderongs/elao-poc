/**
 * A `?next=` value, kept only if it's a same-site path. "//evil.com" and
 * "/\evil.com" (browsers read a backslash as a slash) would both leave the
 * origin, and anything that isn't a path ("javascript:…", "https://…") is
 * dropped too — the result ends up in redirects and `window.location.href`.
 */
export function safeNext(next: string | undefined | null, fallback = "/dashboard"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return fallback;
  // Control characters (tab, newline) are stripped by URL parsing and could rebuild a "//".
  if (/[\u0000-\u001f\u007f]/.test(next)) return fallback;
  return next;
}
