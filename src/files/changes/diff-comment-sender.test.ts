import { describe, expect, it, vi } from "vitest";
import type { InjectOptions, InjectOutcome } from "../../prompts/inject";
import { COMMENT_SUBMIT_DELAY_MS, createCommentSender } from "./diff-comment-sender";

const TARGET = { paneId: 4, agent: "claude", processId: 321 };

describe("createCommentSender", () => {
  it("binds the send to the captured process with the gated, delayed submit", async () => {
    const injectIntoPane = vi.fn().mockResolvedValue("sent");
    const sender = createCommentSender({ injectIntoPane });
    await expect(sender.send(TARGET, "In a.ts:L1: x")).resolves.toBe("sent");
    expect(injectIntoPane).toHaveBeenCalledWith(4, "In a.ts:L1: x", {
      autoSend: true,
      expectedAgent: "claude",
      expectedProcessId: 321,
      submitDelayMs: COMMENT_SUBMIT_DELAY_MS,
    });
  });

  it("passes the inject reasons through and reports a rejection as failed", async () => {
    for (const outcome of ["pasted", "stale", "no-target", "failed"] as const) {
      const sender = createCommentSender({ injectIntoPane: vi.fn().mockResolvedValue(outcome) });
      await expect(sender.send(TARGET, "x")).resolves.toBe(outcome);
    }
    const throwing = createCommentSender({
      injectIntoPane: vi.fn().mockRejectedValue(new Error("pty gone")),
    });
    await expect(throwing.send(TARGET, "x")).resolves.toBe("failed");
  });

  it("never drops a send as busy: a busy pane is reported, not retried silently", async () => {
    const sender = createCommentSender({ injectIntoPane: vi.fn().mockResolvedValue("busy") });
    await expect(sender.send(TARGET, "x")).resolves.toBe("failed");
  });

  it("delivers two rapid sends to one pane in order, never overlapping", async () => {
    const events: string[] = [];
    const releases: Array<() => void> = [];
    const injectIntoPane = vi.fn(
      (_pane: number, text: string, _opts: InjectOptions): Promise<InjectOutcome> => {
        events.push(`start ${text}`);
        return new Promise((resolve) => {
          releases.push(() => {
            events.push(`end ${text}`);
            resolve("sent");
          });
        });
      },
    );
    const sender = createCommentSender({ injectIntoPane });
    const first = sender.send(TARGET, "first");
    const second = sender.send(TARGET, "second");
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    expect(events).toEqual(["start first"]);
    releases[0]();
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases[1]();
    await expect(Promise.all([first, second])).resolves.toEqual(["sent", "sent"]);
    expect(events).toEqual(["start first", "end first", "start second", "end second"]);
  });

  it("lets different panes send at the same time", async () => {
    const started: number[] = [];
    const injectIntoPane = vi.fn((pane: number): Promise<InjectOutcome> => {
      started.push(pane);
      return new Promise(() => {});
    });
    const sender = createCommentSender({ injectIntoPane });
    void sender.send({ ...TARGET, paneId: 1 }, "a");
    void sender.send({ ...TARGET, paneId: 2 }, "b");
    await vi.waitFor(() => expect(started).toEqual([1, 2]));
  });
});
