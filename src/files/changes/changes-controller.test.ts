import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChangesFailure, ChangesReply, ChangesSnapshot } from "../../host/git-changes-host";
import { createChangesController, type ChangesHostPort } from "./changes-controller";
import { MIN_INTERVAL_MS } from "./changes-scheduler";

const ROOT = "/work/repo";
const OTHER = "/work/other";

function snapshot(added = 1, name = "a.ts"): ChangesSnapshot {
  return {
    kind: "changes",
    branch: "main",
    detached: false,
    oid: null,
    initial: false,
    entries: [
      {
        path: name,
        status: "modified",
        oldPath: null,
        added,
        removed: 0,
        binary: false,
        counted: true,
      },
    ],
    omitted: 0,
    totals: { added, removed: 0 },
  };
}

function fakeHost(replies: ChangesReply[] = [snapshot()]) {
  let changed: ((root: string) => void) | null = null;
  const reads: string[] = [];
  const watches: Array<string | null> = [];
  const queue = [...replies];
  const host: ChangesHostPort = {
    readChanges: vi.fn(async (root: string) => {
      reads.push(root);
      return queue.length > 1 ? (queue.shift() as ChangesReply) : queue[0];
    }),
    watchChanges: vi.fn(async (root: string | null) => {
      watches.push(root);
    }),
    listenChanged: vi.fn(async (handler: (root: string) => void) => {
      changed = handler;
      return () => {
        changed = null;
      };
    }),
  };
  return { host, reads, watches, queue, fire: (root: string) => changed?.(root) };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(2_000_000);
});

afterEach(() => {
  vi.useRealTimers();
});

const settle = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

describe("lifecycle", () => {
  it("watches and reads once when the list is shown, and releases when hidden", async () => {
    const { host, reads, watches } = fakeHost();
    const controller = createChangesController({ host });
    controller.setShown(ROOT);
    await settle();
    expect(watches).toEqual([ROOT]);
    expect(reads).toEqual([ROOT]);
    expect(controller.state.value.snapshot?.totals.added).toBe(1);

    controller.setShown(null);
    await settle();
    expect(watches).toEqual([ROOT, null]);
    expect(controller.state.value.root).toBeNull();
  });

  it("hidden window: the watch is released, no read starts, and one read happens on return", async () => {
    const { host, reads, watches, fire } = fakeHost();
    const controller = createChangesController({ host });
    controller.setShown(ROOT);
    await settle();
    controller.setWindowVisible(false);
    expect(watches).toEqual([ROOT, null]);
    fire(ROOT);
    controller.trigger("focus");
    controller.turnEnded(ROOT);
    await settle(60_000);
    expect(reads).toHaveLength(1);

    controller.setWindowVisible(true);
    await settle();
    expect(watches).toEqual([ROOT, null, ROOT]);
    expect(reads).toHaveLength(2);
  });

  it("moving to another root watches it, reads it and drops the old list", async () => {
    const { host, reads, watches } = fakeHost();
    const controller = createChangesController({ host });
    controller.setShown(ROOT);
    await settle();
    controller.setShown(OTHER);
    expect(controller.state.value).toMatchObject({ root: OTHER, snapshot: null, reading: true });
    await settle();
    expect(watches).toEqual([ROOT, OTHER]);
    expect(reads).toEqual([ROOT, OTHER]);
  });

  it("discards a reply that lands after the list moved", async () => {
    let finishFirst: (reply: ChangesReply) => void = () => {};
    const host: ChangesHostPort = {
      readChanges: vi.fn((root: string) =>
        root === ROOT
          ? new Promise<ChangesReply>((resolve) => {
              finishFirst = resolve;
            })
          : Promise.resolve(snapshot(9, "other.ts")),
      ),
      watchChanges: vi.fn(async () => {}),
      listenChanged: vi.fn(async () => () => {}),
    };
    const controller = createChangesController({ host });
    controller.setShown(ROOT);
    await settle();
    controller.setShown(OTHER);
    finishFirst(snapshot(1));
    await settle();
    await settle();
    expect(controller.state.value.root).toBe(OTHER);
    expect(controller.state.value.snapshot?.totals.added).toBe(9);
  });
});

describe("triggers", () => {
  it("a watch event for the shown root reads again; one for another root does not", async () => {
    const { host, reads, fire } = fakeHost();
    const controller = createChangesController({ host });
    controller.setShown(ROOT);
    await settle(MIN_INTERVAL_MS);
    fire(OTHER);
    await settle(2000);
    expect(reads).toHaveLength(1);
    fire(ROOT);
    await settle(2000);
    expect(reads).toHaveLength(2);
  });

  it("a turn end reads only for the shown workspace", async () => {
    const { host, reads } = fakeHost();
    const controller = createChangesController({ host });
    controller.setShown(ROOT);
    await settle(MIN_INTERVAL_MS);
    controller.turnEnded(OTHER);
    await settle(2000);
    expect(reads).toHaveLength(1);
    controller.turnEnded(ROOT);
    await settle(2000);
    expect(reads).toHaveLength(2);
  });

  it("Refresh reads at once", async () => {
    const { host, reads } = fakeHost();
    const controller = createChangesController({ host });
    controller.setShown(ROOT);
    await settle();
    controller.trigger("refresh");
    await settle();
    expect(reads).toHaveLength(2);
  });
});

describe("replies", () => {
  it("an unchanged reply does not publish a new state", async () => {
    const { host } = fakeHost([snapshot(), snapshot()]);
    const controller = createChangesController({ host });
    controller.setShown(ROOT);
    await settle();
    const first = controller.state.value;
    controller.trigger("refresh");
    await settle();
    expect(controller.state.value).toBe(first);
  });

  it("a timeout keeps the last list and records the failure; recovery clears it", async () => {
    const failure: ChangesFailure = { kind: "timeout", message: "slow" };
    const { host } = fakeHost([snapshot(), failure, snapshot()]);
    const controller = createChangesController({ host });
    controller.setShown(ROOT);
    await settle();
    controller.trigger("refresh");
    await settle();
    expect(controller.state.value.failure).toEqual(failure);
    expect(controller.state.value.snapshot?.totals.added).toBe(1);
    controller.trigger("refresh");
    await settle();
    expect(controller.state.value.failure).toBeNull();
  });

  it("a folder that stops being a repository loses its list", async () => {
    const failure: ChangesFailure = { kind: "not-repository", message: "Not a git repository" };
    const { host } = fakeHost([snapshot(), failure]);
    const controller = createChangesController({ host });
    controller.setShown(ROOT);
    await settle();
    controller.trigger("refresh");
    await settle();
    expect(controller.state.value).toMatchObject({ snapshot: null, failure });
  });

  it("a read that rejects becomes a failed reply", async () => {
    const host: ChangesHostPort = {
      readChanges: vi.fn(async () => {
        throw new Error("bridge down");
      }),
      watchChanges: vi.fn(async () => {}),
      listenChanged: vi.fn(async () => () => {}),
    };
    const controller = createChangesController({ host });
    controller.setShown(ROOT);
    await settle();
    expect(controller.state.value.failure).toEqual({ kind: "failed", message: "bridge down" });
  });

  it("dispose releases the watch and the listener", async () => {
    const { host, watches, fire } = fakeHost();
    const controller = createChangesController({ host });
    controller.setShown(ROOT);
    await settle();
    controller.dispose();
    expect(watches).toEqual([ROOT, null]);
    fire(ROOT);
    await settle(5000);
    expect(host.readChanges).toHaveBeenCalledTimes(1);
  });
});
