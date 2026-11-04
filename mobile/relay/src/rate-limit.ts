export interface Bucket {
  readonly tokens: number;
  readonly at: number;
}

export interface BucketTake {
  readonly allowed: boolean;
  readonly bucket: Bucket;
}

/**
 * A token bucket that holds `messages` tokens and refills them evenly over `perMs`, so a burst up
 * to the limit passes and a sustained rate above it does not. Pure: the caller keeps the bucket.
 */
export function takeFromBucket(
  bucket: Bucket | undefined,
  now: number,
  rate: { readonly messages: number; readonly perMs: number },
): BucketTake {
  const before = bucket ?? { tokens: rate.messages, at: now };
  const refilled = Math.min(
    rate.messages,
    before.tokens + ((now - before.at) * rate.messages) / rate.perMs,
  );
  if (refilled < 1) return { allowed: false, bucket: { tokens: refilled, at: now } };
  return { allowed: true, bucket: { tokens: refilled - 1, at: now } };
}

export interface Window {
  readonly start: number;
  readonly count: number;
}

/** A fixed window counter, for the push rate where a hard cap per minute is what MOB8 states. */
export function takeFromWindow(
  window: Window,
  now: number,
  rate: { readonly messages: number; readonly perMs: number },
): { readonly allowed: boolean; readonly window: Window } {
  const current = now - window.start >= rate.perMs ? { start: now, count: 0 } : window;
  if (current.count >= rate.messages) return { allowed: false, window: current };
  return { allowed: true, window: { start: current.start, count: current.count + 1 } };
}
