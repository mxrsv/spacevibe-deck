import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("../host/bridge", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

import { createHostSessionsClient, createMemorySessionsClient } from "./sessions-client";
import type { ResumeRequest, SessionTailAnswer } from "../lib/agent-resume";

const REQUESTS: readonly ResumeRequest[] = [
  { agent: "claude", cwd: "/work/a", lastSeenAt: 1, preferredId: "claude-1" },
  { agent: "codex", cwd: "/work/b", lastSeenAt: 2, preferredId: "codex-2" },
];

const ANSWERS: readonly (SessionTailAnswer | null)[] = [
  { id: "claude-1", tail: "Implemented the client.", model: null },
  { id: "codex-2", tail: null, model: null },
];

beforeEach(() => {
  vi.stubGlobal("__deckHost", { invoke: vi.fn(), listen: vi.fn() });
});

afterEach(() => {
  invoke.mockReset();
  vi.unstubAllGlobals();
});

describe("SessionsClient tails", () => {
  it("returns positional exact-id answers through the host facade", async () => {
    invoke.mockResolvedValueOnce(ANSWERS);

    await expect(createHostSessionsClient().tails(REQUESTS)).resolves.toEqual(ANSWERS);
    expect(invoke).toHaveBeenCalledWith("session_tail", { requests: REQUESTS });
  });

  it("returns deterministic positional exact-id answers from memory", async () => {
    await expect(
      createMemorySessionsClient(null, { tails: ANSWERS }).tails(REQUESTS),
    ).resolves.toEqual(ANSWERS);
  });

  it("pads a shorter memory reply with null at the missing request position", async () => {
    await expect(
      createMemorySessionsClient(null, { tails: [ANSWERS[0]] }).tails(REQUESTS),
    ).resolves.toEqual([ANSWERS[0], null]);
  });

  it("drops a surplus memory reply rather than adding a request position", async () => {
    await expect(
      createMemorySessionsClient(null, {
        tails: [...ANSWERS, { id: "surplus", tail: "must be dropped", model: null }],
      }).tails([REQUESTS[0]]),
    ).resolves.toEqual([ANSWERS[0]]);
  });
});

describe("SessionsClient list", () => {
  it("maps an absent Electron bridge to unsupported", async () => {
    vi.stubGlobal("__deckHost", undefined);

    await expect(createHostSessionsClient().list(5)).resolves.toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("rejects on a transient host invocation failure", async () => {
    invoke.mockRejectedValueOnce(new Error("temporary scan failure"));

    await expect(createHostSessionsClient().list(5)).rejects.toThrow("temporary scan failure");
  });

  it("rejects an invalid host reply as Error", async () => {
    invoke.mockResolvedValueOnce({ nope: true });

    await expect(createHostSessionsClient().list(5)).rejects.toThrow(
      "Invalid sessions_list response",
    );
  });

  it.each([
    ["string", "bridge string failure"],
    ["object", { code: "SESSION_SCAN_FAILED" }],
    ["null", null],
  ])("normalizes a %s bridge rejection to Error", async (_label, failure) => {
    invoke.mockRejectedValueOnce(failure);

    const caught = await createHostSessionsClient()
      .list(5)
      .catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(Error);
    if (typeof failure === "string") {
      expect((caught as Error).message).toBe(failure);
    } else {
      expect(caught).toMatchObject({
        message: "sessions_list failed",
        cause: failure,
      });
    }
  });
});
