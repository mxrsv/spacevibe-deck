export const BACKOFF_MIN_MS = 1_000;
export const BACKOFF_MAX_MS = 30_000;

/** Reconnect delay: 1 s doubling to 30 s, with up to half of it shaved off at random so phones do not stampede. */
export function backoffDelay(attempt: number, random: () => number): number {
  const base = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** Math.max(0, attempt));
  return Math.round(base * (0.5 + random() * 0.5));
}
