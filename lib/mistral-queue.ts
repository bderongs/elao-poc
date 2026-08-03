/**
 * Server-side concurrency cap for Mistral calls — defense in depth against
 * the account-wide rate limit, on top of the client-side single-flight gate
 * in app/page.tsx. An in-process semaphore only caps concurrency per server
 * instance: fine for a single persistent Node process, but on an autoscaling
 * /serverless deploy each instance gets its own counter.
 */

const MAX_CONCURRENCY = Math.max(1, Number(process.env.MISTRAL_MAX_CONCURRENCY) || 2);

let active = 0;
const waiters: Array<() => void> = [];

/** Resolves once a concurrency slot is free. Pair with releaseMistralSlot(). */
export function acquireMistralSlot(): Promise<void> {
  if (active < MAX_CONCURRENCY) {
    active++;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiters.push(resolve));
}

/** Frees a slot acquired via acquireMistralSlot(), handing it to the next waiter if any. */
export function releaseMistralSlot(): void {
  active--;
  const next = waiters.shift();
  if (next) {
    active++;
    next();
  }
}

/** Runs fn() once a concurrency slot is free, releasing it when fn() settles. */
export async function withMistralSlot<T>(fn: () => Promise<T>): Promise<T> {
  await acquireMistralSlot();
  try {
    return await fn();
  } finally {
    releaseMistralSlot();
  }
}
