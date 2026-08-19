import { describe, expect, it } from "vitest";
import {
  bootModeOrNormal,
  createMemoryTransferClient,
  moveToWindowTarget,
  type AdoptionPayload,
} from "./transfer-client";

const payload: AdoptionPayload = {
  paneId: 7,
  cwd: "/repo",
  agentId: "claude",
  scrollback: "hello",
  cols: 120,
  rows: 40,
  tabName: "deck",
  dotColor: "cyan",
  workspacePath: "/repo",
};

describe("bootModeOrNormal", () => {
  it("accepts a well-formed adopt payload", () => {
    expect(bootModeOrNormal({ kind: "adopt", token: "t-1" })).toEqual({
      kind: "adopt",
      token: "t-1",
    });
  });

  it("falls back to normal for anything unrecognized", () => {
    expect(bootModeOrNormal({ kind: "adopt" })).toEqual({ kind: "normal" });
    expect(bootModeOrNormal({ kind: "adopt", token: 42 })).toEqual({
      kind: "normal",
    });
    expect(bootModeOrNormal(null)).toEqual({ kind: "normal" });
    expect(bootModeOrNormal("adopt")).toEqual({ kind: "normal" });
  });
});

describe("createMemoryTransferClient", () => {
  it("records every call in order and hands the staged payload to claim", async () => {
    const client = createMemoryTransferClient();
    const token = await client.prepareTransfer(7);
    await client.stageTransfer(token, payload);
    const claimed = await client.claimTransfer(token);
    await client.commitTransfer(token);
    client.settle(token, { kind: "committed" });

    expect(claimed).toEqual(payload);
    expect(client.calls).toEqual([
      "prepare:7",
      `stage:${token}`,
      `claim:${token}`,
      `commit:${token}`,
    ]);
  });

  it("resolves awaitOutcome with whatever settle reports, even after the fact", async () => {
    const client = createMemoryTransferClient();
    const token = await client.prepareTransfer(1);
    client.settle(token, { kind: "aborted", reason: "destination-gone" });
    await expect(client.awaitOutcome(token)).resolves.toEqual({
      kind: "aborted",
      reason: "destination-gone",
    });
  });
});

describe("moveToWindowTarget", () => {
  it("accepts a well-formed target label", () => {
    expect(moveToWindowTarget({ targetLabel: "deck-2" })).toBe("deck-2");
  });

  it("rejects every malformed shape without producing a label", () => {
    expect(moveToWindowTarget({})).toBeNull();
    expect(moveToWindowTarget({ targetLabel: "" })).toBeNull();
    expect(moveToWindowTarget({ targetLabel: 42 })).toBeNull();
    expect(moveToWindowTarget({ targetLabel: null })).toBeNull();
    expect(moveToWindowTarget({ label: "deck-2" })).toBeNull();
    expect(moveToWindowTarget(null)).toBeNull();
    expect(moveToWindowTarget("deck-2")).toBeNull();
    expect(moveToWindowTarget(undefined)).toBeNull();
  });

  it("delivers a well-formed move-to-window offer to the handler", async () => {
    const client = createMemoryTransferClient();
    const seen: string[] = [];
    await client.listenMoveToWindow((label) => void seen.push(label));
    client.moveToWindow("deck-2");
    expect(seen).toEqual(["deck-2"]);
  });
});
