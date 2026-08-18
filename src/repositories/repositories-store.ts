/**
 * Repository scans and the one piece of rail state the user owns.
 *
 * Design: `docs/specs/2026-08-13-repository-worktree-rail-design.md` §2/§3.
 *
 * Two rules shape this file:
 *
 *  - **Derived git facts are never persisted.** The map below is rebuilt at
 *    every launch. Writing it to disk would create a second truth that is
 *    wrong the moment the user touches git outside Deck, and the read is cheap
 *    enough that a cache buys nothing.
 *  - **Only collapse state is stored**, because it is the only thing in the
 *    rail the user decides rather than git.
 */
import { signal } from '@preact/signals';
import { Store } from '../host/store-host';
import { reportPersistError } from '../chrome/events';
import {
  defaultRepositoryClient,
  type RepositoryClient,
  type RepositoryScan,
} from './repository-client';

const STORE_FILE = 'repositories.json';
const STORE_KEY = 'repositories';
const VERSION = 1;

/** Scan result per workspace path. Rebuilt every launch — never persisted. */
export const repositoryScans = signal<ReadonlyMap<string, RepositoryScan>>(new Map());

/** Repository keys (`--git-common-dir`) the user has collapsed. */
export const collapsedRepositories = signal<ReadonlySet<string>>(new Set());

let store: Store | null = null;
let client: RepositoryClient = defaultRepositoryClient;
/** Paths with a scan in flight — a second request joins rather than doubles. */
const inFlight = new Set<string>();

/** Test seam. The app never calls this; the suite injects a fake client. */
export function configureRepositoryClient(next: RepositoryClient): void {
  client = next;
  inFlight.clear();
}

function isCollapsedList(raw: unknown): raw is {
  repositories: { key: string }[];
} {
  return (
    typeof raw === 'object' &&
    raw !== null &&
    Array.isArray((raw as { repositories?: unknown }).repositories)
  );
}

/**
 * Load collapse state. On any failure the rail starts fully expanded, which is
 * the state a user who has never collapsed anything already has — a store this
 * small has no failure worth reporting.
 */
export async function initRepositories(): Promise<void> {
  try {
    store = await Store.load(STORE_FILE, { defaults: {}, autoSave: false });
    const raw = await store.get<unknown>(STORE_KEY);
    if (isCollapsedList(raw)) {
      collapsedRepositories.value = new Set(
        raw.repositories
          .filter(
            (entry): entry is { key: string } =>
              typeof entry?.key === 'string' && entry.key.length > 0,
          )
          .map((entry) => entry.key),
      );
    }
  } catch (err) {
    console.warn('Failed to load repository rail state, starting open:', err);
  }
}

export function toggleRepositoryCollapsed(key: string): void {
  const current = collapsedRepositories.value;
  const next = new Set(current);
  if (!next.delete(key)) {
    next.add(key);
  }
  collapsedRepositories.value = next;
  if (store === null) {
    return; // browser-only preview: the rail still works, nothing persists
  }
  const payload = {
    version: VERSION,
    repositories: [...next].map((entry) => ({ key: entry })),
  };
  store
    .set(STORE_KEY, payload)
    .then(() => store?.save())
    .catch((err: unknown) => {
      console.warn('Failed to save repository rail state:', err);
      reportPersistError("Repository collapse state wasn't saved");
    });
}

/**
 * Scan every path that has no result yet.
 *
 * A repository scan answers for ALL of its worktrees, so a successful result
 * is written under every worktree path it reported. That is what makes four
 * worktrees of one repository cost one scan rather than four (§1.4) — the
 * second tab finds its answer already in the map.
 */
export function ensureRepositoriesScanned(paths: readonly string[]): void {
  for (const path of paths) {
    if (path.length === 0) {
      continue;
    }
    if (repositoryScans.value.has(path) || inFlight.has(path)) {
      continue;
    }
    inFlight.add(path);
    client
      .scan(path)
      .catch((err: unknown) => {
        // Browser-only preview and a dead bridge both land here. Navigation
        // must not be able to fail, so this degrades exactly like a folder
        // that is not a repository.
        console.warn('git_repository failed:', err);
        return { kind: 'plain', reason: 'scan unavailable' } as RepositoryScan;
      })
      .then((scan) => {
        inFlight.delete(path);
        const next = new Map(repositoryScans.value);
        next.set(path, scan);
        if (scan.kind === 'repository') {
          for (const worktree of scan.worktrees) {
            if (!next.has(worktree.path)) {
              next.set(worktree.path, scan);
            }
          }
        }
        repositoryScans.value = next;
      });
  }
}

/**
 * Drop every scan so the next `ensureRepositoriesScanned` re-reads.
 *
 * The map is emptied rather than refreshed in place: a worktree removed on
 * disk has to be able to leave the list, and merging a fresh scan into a stale
 * map is how a deleted row survives forever.
 */
export function invalidateRepositoryScans(): void {
  inFlight.clear();
  repositoryScans.value = new Map();
}

/**
 * Rescan when the window comes back.
 *
 * This is the invalidation that carries the weight (§2): worktrees are created
 * and removed in a terminal — often one of Deck's own panes — and the moment
 * the user returns to the window is exactly when the list is both stale and
 * being looked at. It replaces a `.git` watcher, which would wake on every
 * fetch, commit and index refresh to keep a list current that changes a few
 * times a day.
 */
export function installRepositoryRescanOnFocus(): () => void {
  const onVisible = (): void => {
    if (document.visibilityState === 'visible') {
      invalidateRepositoryScans();
    }
  };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', onVisible);
  return () => {
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('focus', onVisible);
  };
}
