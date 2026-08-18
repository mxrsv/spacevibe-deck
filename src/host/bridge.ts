/**
 * The renderer's view of the host.
 *
 * `preload.ts` puts exactly two functions on `window.__deckHost`; everything
 * else in `src/host/` is built from them. The signatures mirror Tauri's
 * `invoke` / `listen`, which is what lets the rest of the renderer swap
 * imports rather than change logic.
 */

export type UnlistenFn = () => void;

interface DeckHost {
  invoke(channel: string, payload?: unknown): Promise<unknown>;
  listen(event: string, handler: (payload: unknown) => void): UnlistenFn;
}

function host(): DeckHost {
  const bridge = (globalThis as { __deckHost?: DeckHost }).__deckHost;
  if (bridge === undefined) {
    // Only reachable in a browser-only dev preview or a test that forgot to
    // mock the host. Failing loudly beats a silent no-op that looks like a
    // hung PTY.
    throw new Error('Deck host bridge is unavailable');
  }
  return bridge;
}

/** Call a main-process command. Channel names match the Tauri build's. */
export function invoke<T>(channel: string, payload?: unknown): Promise<T> {
  return host().invoke(channel, payload) as Promise<T>;
}

/**
 * Subscribe to a main-process event.
 *
 * Returns a promise for symmetry with Tauri's `listen`, whose callers all
 * `await` it — keeping the shape means no call site changes.
 */
export async function listen<T>(
  event: string,
  handler: (event: { payload: T }) => void,
): Promise<UnlistenFn> {
  return host().listen(event, (payload) => handler({ payload: payload as T }));
}
