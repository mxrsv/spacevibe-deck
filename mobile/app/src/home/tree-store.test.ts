import { describe, expect, it, vi } from "vitest";
import type { AppEvent } from "@protocol/messages";
import type { Tree } from "@protocol/tree";
import type { ConnectionSnapshot, DesktopConnection } from "@/session/connection";
import { createTreeStore } from "./tree-store";

const treeOf = (title: string): Tree => ({
  projects: [
    {
      name: "deck",
      path: "/deck",
      checkouts: [
        {
          name: "main",
          path: "/deck",
          branch: "main",
          panes: [
            {
              paneId: 1,
              title,
              agent: null,
              agentLabel: null,
              phase: "idle",
              attention: "none",
              attentionSince: null,
              lastLine: "",
              lastOutputAt: null,
            },
          ],
        },
      ],
    },
  ],
});

function fakeConnection(initial: ConnectionSnapshot["status"]) {
  let status = initial;
  const statusListeners = new Set<() => void>();
  const eventListeners = new Set<(e: AppEvent) => void>();
  const request = vi.fn<() => Promise<{ tree: Tree }>>(async () => ({ tree: treeOf("first") }));
  const connection = {
    getSnapshot: () => ({ status }) as ConnectionSnapshot,
    subscribe: (l: () => void) => {
      statusListeners.add(l);
      return () => statusListeners.delete(l);
    },
    onEvent: (l: (e: AppEvent) => void) => {
      eventListeners.add(l);
      return () => eventListeners.delete(l);
    },
    rpc: { request },
  } as unknown as DesktopConnection;
  return {
    connection,
    request,
    setStatus(next: ConnectionSnapshot["status"]) {
      status = next;
      for (const l of [...statusListeners]) l();
    },
    emit: (e: AppEvent) => eventListeners.forEach((l) => l(e)),
    listeners: () => statusListeners.size + eventListeners.size,
  };
}

describe("tree store", () => {
  it("subscribes when the desktop is online and applies tree events", async () => {
    const fake = fakeConnection("connecting");
    const store = createTreeStore(fake.connection);
    store.subscribe(() => {});
    expect(fake.request).not.toHaveBeenCalled();
    fake.setStatus("online");
    await Promise.resolve();
    await Promise.resolve();
    expect(fake.request).toHaveBeenCalledWith("tree.subscribe", {});
    expect(store.getSnapshot().tree?.projects[0].checkouts[0].panes[0].title).toBe("first");
    fake.emit({ ev: "tree", p: { tree: treeOf("second") } });
    expect(store.getSnapshot().tree?.projects[0].checkouts[0].panes[0].title).toBe("second");
  });

  it("subscribes again after a reconnect (subscriptions are replayed)", async () => {
    const fake = fakeConnection("online");
    const store = createTreeStore(fake.connection);
    store.subscribe(() => {});
    await Promise.resolve();
    fake.setStatus("offline");
    fake.setStatus("online");
    await Promise.resolve();
    expect(fake.request).toHaveBeenCalledTimes(2);
  });

  it("refresh asks again, and the last listener leaving stops following", async () => {
    const fake = fakeConnection("online");
    const store = createTreeStore(fake.connection);
    const off = store.subscribe(() => {});
    await store.refresh();
    expect(fake.request).toHaveBeenCalledTimes(2);
    off();
    expect(fake.listeners()).toBe(0);
  });
});
