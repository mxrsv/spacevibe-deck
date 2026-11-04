/**
 * Taps wait here until the app is unlocked and its navigator exists. The notification listener
 * lives above the lock gate and only drops the data in; the router consumes it from below the
 * gate, so no content is reached behind the lock.
 */
export interface TapInbox {
  put(data: unknown): void;
  /** The waiting tap, wrapped so a tap without data is still a tap; null when none waits. */
  take(): { readonly data: unknown } | null;
  subscribe(listener: () => void): () => void;
}

export function createTapInbox(): TapInbox {
  let waiting: { readonly data: unknown } | null = null;
  const listeners = new Set<() => void>();
  return {
    put(data) {
      waiting = { data };
      for (const listener of [...listeners]) listener();
    },
    take() {
      const data = waiting;
      waiting = null;
      return data;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const tapInbox = createTapInbox();
