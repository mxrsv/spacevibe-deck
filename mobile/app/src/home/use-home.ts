import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useDesktopEntries } from "@/app-state/app-provider";
import type { DesktopConnection } from "@/session/connection";
import type { DesktopEntry } from "@/session/manager";
import { selectNeedsYou, type NeedsYou } from "./needs-you";
import { treeStoreFor, type TreeSnapshot } from "./tree-store";

export interface HomeDesktop {
  readonly entry: DesktopEntry;
  readonly tree: TreeSnapshot;
}

export interface HomeData {
  readonly desktops: readonly HomeDesktop[];
  readonly needs: NeedsYou;
}

const EMPTY: HomeData = { desktops: [], needs: { all: [], pinned: [], more: 0 } };

/** One store over every desktop's tree, so a `tree` event on any of them re-renders Home once. */
function combinedStore(entries: readonly DesktopEntry[]) {
  const stores = entries.map((entry) => treeStoreFor(entry.connection));
  let last: { inputs: readonly TreeSnapshot[]; data: HomeData } | null = null;
  return {
    subscribe(listener: () => void) {
      const offs = stores.map((store) => store.subscribe(listener));
      return () => offs.forEach((off) => off());
    },
    getSnapshot(): HomeData {
      const inputs = stores.map((store) => store.getSnapshot());
      if (
        last !== null &&
        last.inputs.length === inputs.length &&
        last.inputs.every((s, i) => s === inputs[i])
      ) {
        return last.data;
      }
      const desktops = entries.map((entry, i) => ({ entry, tree: inputs[i] }));
      const data: HomeData =
        entries.length === 0
          ? EMPTY
          : {
              desktops,
              needs: selectNeedsYou(
                desktops.map(({ entry, tree }) => ({
                  id: entry.summary.pairingId,
                  name: entry.summary.desktopName,
                  tree: tree.status === "online" ? tree.tree : null,
                })),
              ),
            };
      last = { inputs, data };
      return data;
    },
  };
}

export function useHome(): HomeData & { readonly refresh: () => Promise<void> } {
  const entries = useDesktopEntries();
  const store = useMemo(() => combinedStore(entries), [entries]);
  const data = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const refresh = useCallback(async () => {
    await Promise.all(
      entries.map((entry) => {
        // Re-subscribe: an offline desktop gets a reconnect attempt, an online one a fresh tree.
        if (entry.connection.getSnapshot().status === "online") {
          return treeStoreFor(entry.connection).refresh();
        }
        entry.connection.retryNow();
        return Promise.resolve();
      }),
    );
  }, [entries]);
  return { ...data, refresh };
}

export function useTreeSnapshot(connection: DesktopConnection): TreeSnapshot {
  const store = treeStoreFor(connection);
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
