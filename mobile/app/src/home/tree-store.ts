import type { Tree } from "@protocol/tree";
import type { ConnectionStatus, DesktopConnection } from "@/session/connection";

export interface TreeSnapshot {
  readonly status: ConnectionStatus;
  /** The last tree the desktop sent; shown only while `status` is "online". */
  readonly tree: Tree | null;
}

export interface TreeStore {
  getSnapshot(): TreeSnapshot;
  /** Starts the `tree.subscribe` on the first listener and stops following on the last. */
  subscribe(listener: () => void): () => void;
  /** Pull to refresh: ask for the tree again. */
  refresh(): Promise<void>;
}

/** Follows one desktop's tree: subscribes whenever its session is online, applies `tree` events. */
export function createTreeStore(connection: DesktopConnection): TreeStore {
  const listeners = new Set<() => void>();
  let snapshot: TreeSnapshot = { status: connection.getSnapshot().status, tree: null };
  let stopStatus: (() => void) | null = null;
  let stopEvents: (() => void) | null = null;
  let requestedFor = false; // a tree.subscribe was sent for the current online stretch
  let requestedEpoch = -1; // ...on this path (a move to the LAN or back needs a new one)

  const set = (patch: Partial<TreeSnapshot>): void => {
    snapshot = { ...snapshot, ...patch };
    for (const listener of [...listeners]) listener();
  };

  async function request(): Promise<void> {
    try {
      const result = await connection.rpc.request("tree.subscribe", {});
      set({ tree: result.tree });
    } catch {
      // The next status change or a pull to refresh retries; a stale tree is hidden when offline.
      requestedFor = false;
    }
  }

  function onStatus(): void {
    const status = connection.getSnapshot().status;
    if (status !== snapshot.status) set({ status });
    const epoch = connection.getSnapshot().epoch;
    if (status === "online" && (!requestedFor || epoch !== requestedEpoch)) {
      requestedFor = true;
      requestedEpoch = epoch;
      void request();
    } else if (status !== "online") {
      requestedFor = false;
    }
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) {
        stopEvents = connection.onEvent((event) => {
          if (event.ev === "tree") set({ tree: event.p.tree });
        });
        stopStatus = connection.subscribe(onStatus);
        onStatus();
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          stopStatus?.();
          stopEvents?.();
          stopStatus = null;
          stopEvents = null;
          requestedFor = false;
        }
      };
    },
    async refresh() {
      if (connection.getSnapshot().status === "online") await request();
    },
  };
}

const stores = new WeakMap<DesktopConnection, TreeStore>();

/** One store per connection, shared by Home, the pinned cards and the pane screen. */
export function treeStoreFor(connection: DesktopConnection): TreeStore {
  let store = stores.get(connection);
  if (store === undefined) {
    store = createTreeStore(connection);
    stores.set(connection, store);
  }
  return store;
}
