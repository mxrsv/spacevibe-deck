import { describe, expect, it } from "vitest";
import {
  bootModeOrNormal,
  createMemoryTransferClient,
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
