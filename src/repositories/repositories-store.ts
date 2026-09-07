/**
 * Repository scans and the one piece of rail state the user owns.
 *
 * See `docs/internals/agent-rail.md` (section "Other surfaces in the column").
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
import { signal } from "@preact/signals";
import { Store } from "../host/store-host";
import { reportPersistError } from "../chrome/events";
import {
  defaultRepositoryClient,
  type RepositoryClient,
  type RepositoryScan,
} from "./repository-client";

const STORE_FILE = "repositories.json";
const STORE_KEY = "repositories";
const VERSION = 1;

/** Scan result per workspace path. Rebuilt every launch — never persisted. */
export const repositoryScans = signal<ReadonlyMap<string, RepositoryScan>>(new Map());

/** Repository keys (`--git-common-dir`) the user has collapsed. */
export const collapsedRepositories = signal<ReadonlySet<string>>(new Set());

let store: Store | null = null;
let client: RepositoryClient = defaultRepositoryClient;
/** Paths with a scan in flight — a second request joins rather than doubles. */
const inFlight = new Set<string>();

/**
 * Which round of reading the map holds.
 *
 * A SIGNAL, and that is load-bearing: `ensureRepositoriesScanned` reads it, so
 * the callers that ask for scans inside a `useSignalEffect` (both rails) are
 * subscribed to it and re-run when a refresh bumps it. Emptying
 * `repositoryScans` used to be what woke them; nothing empties it now, so the
 * wake-up needs a signal of its own or a refresh would mark everything stale
 * and never ask anybody to re-read it.
 */
const scanRound = signal(0);
/** The round each path was last answered under; older than `scanRound` = stale. */
const answeredAt = new Map<string, number>();

/** Test seam. The app never calls this; the suite injects a fake client. */
export function configureRepositoryClient(next: RepositoryClient): void {
  client = next;
  inFlight.clear();
  answeredAt.clear();
  scanRound.value += 1;
}

function isCollapsedList(raw: unknown): raw is {
  repositories: { key: string }[];
} {
  return (
    typeof raw === "object" &&
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
              typeof entry?.key === "string" && entry.key.length > 0,
          )
          .map((entry) => entry.key),
      );
    }
  } catch (err) {
    console.warn("Failed to load repository rail state, starting open:", err);
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
      console.warn("Failed to save repository rail state:", err);
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
  // Read, not just incremented elsewhere: this is the subscription that makes
  // a refresh reach the effects that call this.
  const round = scanRound.value;
  for (const path of paths) {
    if (path.length === 0) {
      continue;
    }
    // Keyed on the ROUND rather than on the map's contents. A path answered in
    // an older round is stale even though its scan is still on screen — which
    // is the whole point: the old answer keeps painting while the new one is
    // read.
    if (answeredAt.get(path) === round || inFlight.has(path)) {
      continue;
    }
    inFlight.add(path);
    client
      .scan(path)
      .catch((err: unknown) => {
        // Browser-only preview and a dead bridge both land here. Navigation
        // must not be able to fail, so this degrades exactly like a folder
        // that is not a repository.
        console.warn("git_repository failed:", err);
        return { kind: "plain", reason: "scan unavailable" } as RepositoryScan;
      })
      .then((scan) => {
        inFlight.delete(path);
        if (round !== scanRound.peek()) {
          // A newer refresh asked the same question again while this read was
          // out. This answer describes the tree BEFORE the event that asked,
          // so it is dropped rather than published over the newer one.
          return;
        }
        answeredAt.set(path, round);
        repositoryScans.value = applyScan(repositoryScans.value, path, scan, round);
      });
  }
}

/**
 * Fold one fresh scan into the visible map, replacing per REPOSITORY.
 *
 * The map used to be emptied before a re-read, and the reason given was sound
 * as far as it went: a worktree removed on disk has to be able to leave the
 * list, and merging a fresh scan into a stale map is how a deleted row
 * survives forever. What it did not justify was emptying the map BEFORE the
 * replacement existed — which cost a visible re-render with no scans at all,
 * where every cluster re-keys to `plain:<path>`, each repository splits into
 * one cluster per worktree, and every folded remembered header unfolds. On a
 * window focus that is a flash on every Cmd-Tab back into Deck.
 *
 * Replacing per repository gets the same freshness with no empty window: the
 * fresh scan is the whole truth for its own key, so the worktrees the PREVIOUS
 * scan reported and this one does not are dropped, and nothing else is
 * touched. A path that is a subdirectory of a worktree rather than a worktree
 * itself keeps its entry until its own read answers.
 */
function applyScan(
  current: ReadonlyMap<string, RepositoryScan>,
  path: string,
  scan: RepositoryScan,
  round: number,
): ReadonlyMap<string, RepositoryScan> {
  const next = new Map(current);
  if (scan.kind !== "repository") {
    next.set(path, scan);
    return next;
  }
  const previous = current.get(path);
  if (previous?.kind === "repository" && previous.key === scan.key) {
    const fresh = new Set(scan.worktrees.map((worktree) => worktree.path));
    for (const worktree of previous.worktrees) {
      if (!fresh.has(worktree.path)) {
        next.delete(worktree.path);
        answeredAt.delete(worktree.path);
      }
    }
  }
  next.set(path, scan);
  // A repository scan answers for ALL of its worktrees, so it is written under
  // every path it reported and stamped with it. That is what makes four
  // worktrees of one repository cost one scan rather than four (§1.4).
  for (const worktree of scan.worktrees) {
    next.set(worktree.path, scan);
    answeredAt.set(worktree.path, round);
  }
  return next;
}

/**
 * Ask for a fresh read of everything, WITHOUT taking the current answer off
 * screen. Every path becomes stale, the next `ensureRepositoriesScanned`
 * re-reads it, and each result replaces its own repository as it lands.
 */
export function refreshRepositoryScans(): void {
  inFlight.clear();
  scanRound.value += 1;
}

/**
 * Drop every scan outright.
 *
 * The hard reset: the map is emptied and the rail degrades to the flat,
 * scan-less list until answers come back. `refreshRepositoryScans` is what
 * ordinary staleness wants; this is for a caller that means "forget what you
 * know", and for the suite's own `beforeEach` hooks.
 */
export function invalidateRepositoryScans(): void {
  inFlight.clear();
  answeredAt.clear();
  // Bumped so a read still in flight cannot repopulate the map it just left.
  scanRound.value += 1;
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
 *
 * It REFRESHES rather than invalidates: the answer on screen stays there until
 * a newer one replaces it. Emptying the map here is what made the sidebar jump
 * on every return to the window.
 */
export function installRepositoryRescanOnFocus(): () => void {
  const onVisible = (): void => {
    if (document.visibilityState === "visible") {
      refreshRepositoryScans();
    }
  };
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", onVisible);
  return () => {
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("focus", onVisible);
  };
}
