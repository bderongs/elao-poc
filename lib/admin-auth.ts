// Simple v1 gate for the internal admin tool — a single shared password, not
// a real user/auth system. Session cookie holds a hash of ADMIN_PASSWORD
// rather than the password itself, so it isn't readable from the cookie.
// Uses Web Crypto (not Node's `crypto` module) so this also works from
// middleware, which runs on the Edge Runtime.
export const ADMIN_COOKIE_NAME = "elao_admin_session";

async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function adminSessionToken(): Promise<string | null> {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return null;
  return hash(password);
}

export function verifyAdminPassword(input: string): boolean {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return false;
  return input === password;
}

export async function isValidAdminCookie(value: string | undefined): Promise<boolean> {
  if (!value) return false;
  const expected = await adminSessionToken();
  return !!expected && value === expected;
}
