import { describe, expect, it, vi } from "vitest";
import { createMemoryTransferClient } from "./transfer-client";
import { detachPane, type DetachDeps, type PaneIdentity } from "./pane-detach";
import type { Pane } from "./pane";

const identity: PaneIdentity = {
  cwd: "/repo",
  agentId: "claude",
  tabName: "deck",
  dotColor: "cyan",
  workspacePath: "/repo",
};

function harness(
  overrides: Partial<{
    serializeScrollback: Pane["serializeScrollback"];
    flush: Pane["flush"];
  }> = {},
) {
  const order: string[] = [];
  const transfer = createMemoryTransferClient();
  const pane = {
    id: 7,
    cols: 120,
    rows: 40,
    flush:
      overrides.flush ??
      (() => {
        order.push("flush");
        return Promise.resolve();
      }),
    serializeScrollback:
      overrides.serializeScrollback ??
      (() => {
        order.push("serialize");
        return "SCROLLBACK";
      }),
  };
  const released: number[] = [];
  const messages: string[] = [];
  let held = 0;
  const deps: DetachDeps = {
    transfer,
    drainWrites: async () => {
      order.push("drain");
    },
    holdWrites: () => {
      order.push("hold");
      held += 1;
      return () => {
        order.push("release-hold");
        held -= 1;
      };
    },
    pane: () => pane as unknown as Pane & { cols: number; rows: number },
    geometry: () => ({ cols: pane.cols, rows: pane.rows }),
    identity: () => identity,
    release: (id) => {
      order.push("release");
      released.push(id);
    },
    report: (message) => void messages.push(message),
  };
  return { order, transfer, deps, released, messages, heldNow: () => held };
}

describe("detachPane happy path", () => {
  it("runs drain, hold, flush, prepare, serialize, stage, open, await, release in that order", async () => {
    const h = harness();
    const promise = detachPane(7, { kind: "new-window" }, h.deps);
    await vi.waitFor(() => expect(h.transfer.calls).toContain("await:xfer-1"));
    h.transfer.settle("xfer-1", { kind: "committed" });

    await expect(promise).resolves.toEqual({ kind: "moved" });
    expect(h.order).toEqual([
      "drain",
      "hold",
      "flush",
      // Flushed again after prepare: anything that landed between the first
      // flush and the route change is unparsed, unbuffered and would be lost.
      "flush",
      "serialize",
      "release",
      "release-hold",
    ]);
    expect(h.transfer.calls).toEqual([
      "prepare:7",
      "stage:xfer-1",
      // Subscribed BEFORE the handover, or a fast destination commits before
      // the source is listening and the source waits forever.
      "await:xfer-1",
      "open-window:xfer-1",
    ]);
    expect(h.heldNow()).toBe(0);
  });

  it("stages the identity, the geometry and the serialized scrollback", async () => {
    const h = harness();
    const promise = detachPane(7, { kind: "new-window" }, h.deps);
    await vi.waitFor(() => expect(h.transfer.calls).toContain("await:xfer-1"));
    h.transfer.settle("xfer-1", { kind: "committed" });
    await promise;

    const staged = await createStagedProbe(h.transfer);
    expect(staged).toMatchObject({
      paneId: 7,
      cwd: "/repo",
      agentId: "claude",
      scrollback: "SCROLLBACK",
      cols: 120,
      rows: 40,
      tabName: "deck",
      dotColor: "cyan",
      workspacePath: "/repo",
    });
  });

  it("offers the token to a named window instead of opening one", async () => {
    const h = harness();
    const promise = detachPane(7, { kind: "window", label: "deck-2" }, h.deps);
    await vi.waitFor(() => expect(h.transfer.calls).toContain("await:xfer-1"));
    h.transfer.settle("xfer-1", { kind: "committed" });
    await promise;

    expect(h.transfer.calls).toContain("offer:xfer-1:deck-2");
    expect(h.transfer.calls).not.toContain("open-window:xfer-1");
  });
});

/** Reads back what `stage_transfer` received, through claim. */
async function createStagedProbe(
  transfer: ReturnType<typeof createMemoryTransferClient>,
) {
  return transfer.claimTransfer("xfer-1");
}

describe("detachPane failure injection", () => {
  it("leaves the pane in place when the pane is already gone", async () => {
    const h = harness();
    h.deps.pane = () => undefined;
    await expect(
      detachPane(7, { kind: "new-window" }, h.deps),
    ).resolves.toEqual({
      kind: "kept",
      reason: "unknown-pane",
    });
    expect(h.transfer.calls).toEqual([]);
  });

  it("releases the hold and keeps the pane when prepare fails", async () => {
    const h = harness();
    h.transfer.failNext("prepareTransfer", "already transferring");
    await expect(
      detachPane(7, { kind: "new-window" }, h.deps),
    ).resolves.toEqual({
      kind: "kept",
      reason: "prepare-failed",
    });
    expect(h.released).toEqual([]);
    expect(h.heldNow()).toBe(0);
    expect(h.messages).toHaveLength(1);
  });

  it("aborts, keeps the pane and reports when stage fails", async () => {
    const h = harness();
    h.transfer.failNext("stageTransfer", "payload too large");
    await expect(
      detachPane(7, { kind: "new-window" }, h.deps),
    ).resolves.toEqual({
      kind: "kept",
      reason: "stage-failed",
    });
    expect(h.transfer.calls).toContain("abort:xfer-1");
    expect(h.released).toEqual([]);
    expect(h.heldNow()).toBe(0);
  });

  it("aborts and keeps the pane when the window cannot be opened", async () => {
    const h = harness();
    h.transfer.failNext("openPaneWindow", "window creation failed");
    await expect(
      detachPane(7, { kind: "new-window" }, h.deps),
    ).resolves.toEqual({
      kind: "kept",
      reason: "open-window-failed",
    });
    expect(h.transfer.calls).toContain("abort:xfer-1");
    expect(h.released).toEqual([]);
  });

  it("keeps the pane and reports when the transaction aborts after staging", async () => {
    const h = harness();
    const promise = detachPane(7, { kind: "new-window" }, h.deps);
    await vi.waitFor(() => expect(h.transfer.calls).toContain("await:xfer-1"));
    h.transfer.settle("xfer-1", { kind: "aborted", reason: "claim-failed" });

    await expect(promise).resolves.toEqual({
      kind: "kept",
      reason: "claim-failed",
    });
    expect(h.released).toEqual([]);
    expect(h.heldNow()).toBe(0);
    expect(h.messages[0]).toContain("stayed here");
  });

  it("moves with empty scrollback rather than failing when serialization throws", async () => {
    const h = harness({
      serializeScrollback: () => {
        throw new Error("buffer unreadable");
      },
    });
    const promise = detachPane(7, { kind: "new-window" }, h.deps);
    await vi.waitFor(() => expect(h.transfer.calls).toContain("await:xfer-1"));
    h.transfer.settle("xfer-1", { kind: "committed" });

    await expect(promise).resolves.toEqual({ kind: "moved" });
    const staged = await h.transfer.claimTransfer("xfer-1");
    expect(staged.scrollback).toBe("");
  });

  it("proceeds when flush rejects — a stalled parser must not strand the pane", async () => {
    const h = harness({
      flush: () => Promise.reject(new Error("parser dead")),
    });
    const promise = detachPane(7, { kind: "new-window" }, h.deps);
    await vi.waitFor(() => expect(h.transfer.calls).toContain("await:xfer-1"));
    h.transfer.settle("xfer-1", { kind: "committed" });

    await expect(promise).resolves.toEqual({ kind: "moved" });
  });
});
