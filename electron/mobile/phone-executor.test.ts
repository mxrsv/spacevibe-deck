import { describe, expect, it, vi } from "vitest";
import type { Request } from "../../mobile/protocol/src/messages";
import { joinChunks } from "../../mobile/protocol/src/chunk";
import { EMPTY_COUNTERS } from "../../src/lib/usage-snapshot";
import { createPhoneExecutor, INLINE_BODY_CHARS, type ExecutorSession } from "./phone-executor";
import { PhoneError } from "./phone-error";

const session: ExecutorSession = {
  id: "s1",
  sink: { snapshot: vi.fn(), data: vi.fn(), resize: vi.fn(), end: vi.fn() },
  pushTree: vi.fn(),
};

function harness() {
  const unsubscribeTree = vi.fn();
  const begin = vi.fn();
  const deps = {
    panes: {
      read: vi.fn(async () => "screen"),
      send: vi.fn(async () => ({ outcome: "sent" })),
      input: vi.fn(),
      open: vi.fn(async () => ({ paneId: 12 })),
    },
    files: {
      list: vi.fn(async () => [{ name: "a", kind: "file" as const, size: 1 }]),
      read: vi.fn(async () => ({ text: "hi", truncated: false, binary: false })),
      changes: vi.fn(async () => []),
      diff: vi.fn(async () => ({ diff: "d", truncated: false })),
    },
    tree: {
      snapshot: vi.fn(async () => ({ projects: [] })),
      subscribe: vi.fn(() => unsubscribeTree),
      projects: vi.fn(async () => []),
      agents: vi.fn(async () => [{ id: "claude", label: "Claude Code" }]),
      windowHolding: vi.fn(),
      isKnownRoot: vi.fn(),
    },
    streams: {
      subscribe: vi.fn(async () => ({ ok: true as const, sub: "x", cols: 80, rows: 24, begin })),
      unsubscribe: vi.fn(() => true),
      closeOwner: vi.fn(),
      paneGone: vi.fn(),
      fromRenderer: vi.fn(),
    },
    usage: vi.fn(async () => ({ scannedAtMs: 0, buckets: [], sources: [], skippedLines: 0 })),
    log: vi.fn(),
    newId: () => "chunk1",
    onUsage: vi.fn(),
  };
  return { deps, executor: createPhoneExecutor(deps), unsubscribeTree, begin };
}

const request = <M extends Request["m"]>(m: M, p: Extract<Request, { m: M }>["p"]) =>
  ({ id: 1, m, p }) as Request;

describe("phone executor", () => {
  it("answers every method with a successful response", async () => {
    const { executor } = harness();
    const calls: Request[] = [
      request("tree.subscribe", {}),
      request("tree.unsubscribe", {}),
      request("pane.subscribe", { paneId: 3 }),
      request("pane.unsubscribe", { sub: "x" }),
      request("pane.input", { paneId: 3, data: "y" }),
      request("pane.send", { paneId: 3, text: "go", submit: true }),
      request("pane.read", { paneId: 3, lines: 10 }),
      request("pane.open", {
        projectPath: "/p",
        checkoutPath: "/p",
        agent: "claude",
        prompt: null,
      }),
      request("projects.list", {}),
      request("agents.list", {}),
      request("files.list", { root: "/p", path: "" }),
      request("files.read", { root: "/p", path: "a" }),
      request("changes.list", { root: "/p" }),
      request("changes.diff", { root: "/p", path: "a" }),
      request("usage.get", {}),
    ];
    for (const call of calls) {
      const outcome = await executor.handle(session, call);
      expect(outcome.response, call.m).toMatchObject({ id: 1, ok: true });
    }
  });

  it("starts a pane stream only after the response, via the after hook", async () => {
    const { executor, begin } = harness();
    const outcome = await executor.handle(session, request("pane.subscribe", { paneId: 3 }));
    expect(outcome.response).toMatchObject({ ok: true, r: { sub: "x", cols: 80, rows: 24 } });
    expect(begin).not.toHaveBeenCalled();
    outcome.after?.();
    expect(begin).toHaveBeenCalledOnce();
  });

  it("maps a PhoneError to its protocol code and anything else to internal, without the detail", async () => {
    const { executor, deps } = harness();
    deps.panes.read.mockRejectedValueOnce(new PhoneError("no-target", "gone"));
    expect(
      (await executor.handle(session, request("pane.read", { paneId: 1, lines: 5 }))).response,
    ).toMatchObject({
      ok: false,
      e: { code: "no-target" },
    });
    deps.panes.read.mockRejectedValueOnce(new Error("secret path /Users/x"));
    const outcome = await executor.handle(session, request("pane.read", { paneId: 1, lines: 5 }));
    expect(JSON.stringify(outcome.response)).not.toContain("/Users/x");
    expect(outcome.response).toMatchObject({ ok: false, e: { code: "internal" } });
  });

  it("chunks a large body, response first, and the chunks join back to the text", async () => {
    const { executor, deps } = harness();
    const big = "x".repeat(INLINE_BODY_CHARS * 3);
    deps.files.read.mockResolvedValueOnce({ text: big, truncated: true, binary: false });
    const outcome = await executor.handle(
      session,
      request("files.read", { root: "/p", path: "a" }),
    );
    expect(outcome.response).toMatchObject({
      ok: true,
      r: { chunked: "chunk1", truncated: true, binary: false },
    });
    const joined = joinChunks(outcome.chunks);
    expect(joined.ok && joined.text).toBe(big);
  });

  it("re-subscribing to the tree replaces the old subscription, and closing a session drops everything", async () => {
    const { executor, deps, unsubscribeTree } = harness();
    await executor.handle(session, request("tree.subscribe", {}));
    await executor.handle(session, request("tree.subscribe", {}));
    expect(unsubscribeTree).toHaveBeenCalledOnce();
    executor.closeSession("s1");
    expect(unsubscribeTree).toHaveBeenCalledTimes(2);
    expect(deps.streams.closeOwner).toHaveBeenCalledWith("s1");
  });

  it("counts sends and opens, nothing else", async () => {
    const { executor, deps } = harness();
    await executor.handle(session, request("pane.send", { paneId: 1, text: "a", submit: false }));
    await executor.handle(
      session,
      request("pane.open", {
        projectPath: "/p",
        checkoutPath: "/p",
        agent: "claude",
        prompt: null,
      }),
    );
    await executor.handle(session, request("pane.read", { paneId: 1, lines: 5 }));
    expect(deps.onUsage.mock.calls).toEqual([["send"], ["open"]]);
  });

  it("sums usage through the shared summary", async () => {
    const { executor, deps } = harness();
    deps.usage.mockResolvedValueOnce({
      scannedAtMs: 1,
      buckets: [
        {
          bucketStartMs: Date.now(),
          agent: "claude",
          model: "m",
          repo: null,
          counters: { ...EMPTY_COUNTERS, output: 5 },
        },
      ],
      sources: [],
      skippedLines: 0,
    });
    const outcome = await executor.handle(session, request("usage.get", {}));
    expect(outcome.response).toMatchObject({ ok: true, r: { usage: { today: { tokens: 5 } } } });
  });
});
