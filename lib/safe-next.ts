/** A `?next=` value, kept only if it's a same-site path ("//evil.com" would leave the origin). */
export function safeNext(next: string | undefined | null, fallback = "/dashboard"): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : fallback;
}
