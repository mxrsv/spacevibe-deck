import { describe, expect, it, vi } from "vitest";

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
  { id: "claude-1", tail: "Implemented the client." },
  { id: "codex-2", tail: null },
];

describe("SessionsClient tails", () => {
  it("returns positional exact-id answers through the host facade", async () => {
    invoke.mockResolvedValueOnce(ANSWERS);

    await expect(createHostSessionsClient().tails(REQUESTS)).resolves.toEqual(ANSWERS);
    expect(invoke).toHaveBeenCalledWith("session_tail", { requests: REQUESTS });
  });

  it("returns deterministic positional exact-id answers from memory", async () => {
    await expect(createMemorySessionsClient(null, { tails: ANSWERS }).tails(REQUESTS)).resolves.toEqual(
      ANSWERS,
    );
  });
});
