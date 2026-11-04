import type { KeyValueStore } from "@/storage/key-value";

/** The phone's few preferences. They live in the Keychain with the pairings: no AsyncStorage. */
export interface Prefs {
  /** Face ID or the passcode at launch and after 5 minutes in the background (MOB4). On by default. */
  readonly faceIdLock: boolean;
  /** The phone's own switch for push (decision 24); push delivery itself arrives in T9. */
  readonly notifications: boolean;
}

export const DEFAULT_PREFS: Prefs = { faceIdLock: true, notifications: true };

const KEY = "deck.prefs";

/** Anything unreadable falls back to the defaults, so a corrupt value can only make the app safer. */
export function parsePrefs(text: string | null): Prefs {
  if (text === null) return DEFAULT_PREFS;
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null) return DEFAULT_PREFS;
    const record = value as Record<string, unknown>;
    return {
      faceIdLock:
        typeof record.faceIdLock === "boolean" ? record.faceIdLock : DEFAULT_PREFS.faceIdLock,
      notifications:
        typeof record.notifications === "boolean"
          ? record.notifications
          : DEFAULT_PREFS.notifications,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export interface PrefsController {
  /** `loaded` is false until the Keychain was read; the lock must not guess before then. */
  getSnapshot(): { readonly loaded: boolean; readonly prefs: Prefs };
  subscribe(listener: () => void): () => void;
  load(): Promise<void>;
  update(patch: Partial<Prefs>): Promise<void>;
}

export function createPrefsController(kv: KeyValueStore): PrefsController {
  const listeners = new Set<() => void>();
  let snapshot: { readonly loaded: boolean; readonly prefs: Prefs } = {
    loaded: false,
    prefs: DEFAULT_PREFS,
  };
  const publish = (next: typeof snapshot): void => {
    snapshot = next;
    for (const listener of [...listeners]) listener();
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async load() {
      let text: string | null = null;
      try {
        text = await kv.get(KEY);
      } catch {
        // An unreadable Keychain keeps the safe defaults (lock on).
      }
      publish({ loaded: true, prefs: parsePrefs(text) });
    },
    async update(patch) {
      const prefs = { ...snapshot.prefs, ...patch };
      publish({ loaded: true, prefs });
      await kv.set(KEY, JSON.stringify(prefs));
    },
  };
}
