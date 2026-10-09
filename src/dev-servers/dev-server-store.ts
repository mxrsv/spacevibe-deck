/**
 * Dev server discovery — the renderer's signals store. Nonvisual: nothing mounts it yet.
 *
 * Consumers `start` observation with their roots and get a handle. The store registers the
 * deduplicated union of every live consumer's roots with main (one interest per window),
 * polls main's CACHED snapshot only while at least one consumer observes, and releases
 * when the last one stops. Main owns native scan timing; this poll never starts a scan.
 *
 * Ordering: every host call that changes registration goes through one promise chain, so
 * root changes are applied in order and a release can never overtake a registration. A
 * snapshot is accepted only for the generation the last accepted registration returned
 * and never with a lower `sequence`, so a late reply for old roots cannot overwrite newer
 * state. Failures set `error` and keep the last good snapshot; nothing collapses to empty.
 *
 * All consumers see the one snapshot for the union of roots. Main attributes each row to
 * the deepest root in that union, so a consumer that needs only its own roots must filter
 * rows itself.
 */
import { batch, signal, type ReadonlySignal } from "@preact/signals";
import { devServerHost } from "../host/dev-server-host";
import type {
  DevServerCapability,
  DevServerHost,
  DevServerResolveResult,
  DevServerRootDiagnostic,
  DevServerSnapshot,
} from "./dev-server-types";

/** How often cached snapshots are re-read while observed. Main's scan cadence is separate. */
export const SNAPSHOT_POLL_INTERVAL_MS = 1_000;

export interface DevServerStoreError {
  readonly operation: "register" | "snapshot" | "release";
  readonly message: string;
}

/** One consumer's claim on observation. All methods are safe to call after `stop`. */
export interface DevServerObserver {
  /** Replace this consumer's roots; the union is re-registered in order. */
  updateRoots(roots: readonly string[]): Promise<void>;
  /** Re-register if needed and read a fresh snapshot now. */
  refresh(): Promise<void>;
  /** Drop this consumer. Idempotent. The last stop releases main's interest. */
  stop(): Promise<void>;
}

export interface DevServerStore {
  /** Latest accepted snapshot; null before the first or when nothing is observed. */
  readonly snapshot: ReadonlySignal<DevServerSnapshot | null>;
  /** null = not yet known; `available: false` = unsupported host/OS, not "empty". */
  readonly capability: ReadonlySignal<DevServerCapability | null>;
  readonly rootDiagnostics: ReadonlySignal<readonly DevServerRootDiagnostic[]>;
  /** Last failure, cleared by the next success. The previous snapshot is kept. */
  readonly error: ReadonlySignal<DevServerStoreError | null>;
  /** True while at least one consumer is started. */
  readonly observing: ReadonlySignal<boolean>;
  start(roots: readonly string[]): DevServerObserver;
  /** Pass-through to main; not queued, so it answers even while a registration is in flight. */
  resolve(id: string, instanceToken: string): Promise<DevServerResolveResult>;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function rootsKey(roots: readonly string[]): string {
  return JSON.stringify(roots);
}

export function createDevServerStore(
  host: DevServerHost,
  pollIntervalMs: number = SNAPSHOT_POLL_INTERVAL_MS,
): DevServerStore {
  const snapshot = signal<DevServerSnapshot | null>(null);
  const capability = signal<DevServerCapability | null>(null);
  const rootDiagnostics = signal<readonly DevServerRootDiagnostic[]>([]);
  const error = signal<DevServerStoreError | null>(null);
  const observing = signal(false);

  const consumers = new Set<{ roots: readonly string[] }>();
  let queue: Promise<void> = Promise.resolve();
  let registeredKey: string | null = null;
  let generation: number | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let pollQueued = false;

  function wantedRoots(): readonly string[] {
    const union = new Set<string>();
    for (const consumer of consumers) {
      consumer.roots.forEach((root) => union.add(root));
    }
    return [...union].sort();
  }

  function enqueue(task: () => Promise<void>): Promise<void> {
    const run = queue.then(task);
    queue = run.catch(() => undefined);
    return run;
  }

  function fail(operation: DevServerStoreError["operation"], cause: unknown): void {
    error.value = { operation, message: messageOf(cause) };
  }

  /** A success clears only its own failure, so a later read cannot hide a failed register. */
  function clearError(operation: DevServerStoreError["operation"]): void {
    if (error.value?.operation === operation) {
      error.value = null;
    }
  }

  function clearObservation(): void {
    batch(() => {
      snapshot.value = null;
      rootDiagnostics.value = [];
      generation = null;
      registeredKey = null;
    });
  }

  function accepts(next: DevServerSnapshot): boolean {
    if (generation === null || next.generation !== generation) {
      return false;
    }
    const current = snapshot.value;
    return (
      current === null ||
      current.generation !== next.generation ||
      next.sequence >= current.sequence
    );
  }

  async function readSnapshot(): Promise<void> {
    if (generation === null) {
      return;
    }
    try {
      const next = await host.snapshot();
      if (next.generation === 0 && next.capability.available) {
        // Main no longer holds this window's roots (released or superseded elsewhere).
        // Not an error and not data: re-register on the next reconcile.
        registeredKey = null;
        return;
      }
      if (!accepts(next)) {
        return;
      }
      batch(() => {
        // Equal sequence still updates: main re-derives staleness on read.
        if (JSON.stringify(snapshot.value) !== JSON.stringify(next)) {
          snapshot.value = next;
        }
        capability.value = next.capability;
        clearError("snapshot");
      });
    } catch (cause) {
      fail("snapshot", cause);
    }
  }

  async function register(roots: readonly string[], key: string): Promise<void> {
    try {
      const reply = await host.setRoots(roots);
      // Applied even if every consumer stopped meanwhile: main now holds this interest, and
      // the queued release only runs when it knows about it.
      if (!reply.applied) {
        // Superseded by a newer call or a release: main changed nothing, so neither do we.
        // The key stays unregistered and the next reconcile tries again.
        return;
      }
      batch(() => {
        generation = reply.generation;
        registeredKey = key;
        capability.value = reply.capability;
        rootDiagnostics.value = reply.rootDiagnostics;
        clearError("register");
        clearError("release");
      });
    } catch (cause) {
      fail("register", cause);
    }
  }

  async function release(): Promise<void> {
    clearObservation();
    try {
      await host.release();
    } catch (cause) {
      fail("release", cause);
    }
  }

  /** Bring main's interest in line with what the consumers want right now. */
  async function reconcile(): Promise<void> {
    const roots = wantedRoots();
    const key = rootsKey(roots);
    if (roots.length === 0) {
      if (registeredKey !== null || generation !== null) {
        await release();
      }
    } else if (key !== registeredKey) {
      await register(roots, key);
    }
    syncTimer();
  }

  function syncTimer(): void {
    const shouldPoll =
      consumers.size > 0 && wantedRoots().length > 0 && capability.value?.available !== false;
    if (shouldPoll && timer === null) {
      timer = setInterval(poll, pollIntervalMs);
    } else if (!shouldPoll && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  function poll(): void {
    if (pollQueued) {
      return;
    }
    pollQueued = true;
    void enqueue(async () => {
      pollQueued = false;
      await reconcileAndRead();
    });
  }

  async function reconcileAndRead(): Promise<void> {
    await reconcile();
    await readSnapshot();
    syncTimer();
  }

  function applyChange(): Promise<void> {
    observing.value = consumers.size > 0;
    return enqueue(reconcileAndRead);
  }

  function start(roots: readonly string[]): DevServerObserver {
    const consumer = { roots: [...roots] };
    let stopped = false;
    consumers.add(consumer);
    const initial = applyChange();
    // The caller may never await the first registration; failures live in `error`.
    initial.catch(() => undefined);
    return {
      updateRoots(next) {
        if (stopped) {
          return Promise.resolve();
        }
        consumer.roots = [...next];
        return applyChange();
      },
      refresh() {
        return stopped ? Promise.resolve() : enqueue(reconcileAndRead);
      },
      stop() {
        if (stopped) {
          return Promise.resolve();
        }
        stopped = true;
        consumers.delete(consumer);
        return applyChange();
      },
    };
  }

  return {
    snapshot,
    capability,
    rootDiagnostics,
    error,
    observing,
    start,
    resolve: (id, instanceToken) => host.resolve(id, instanceToken),
  };
}

/** The window's store, wired to the real host facade. */
export const devServerStore: DevServerStore = createDevServerStore(devServerHost);
