import { describe, expect, it } from "vitest";
import { createAgentAttentionTracker } from "./agent-attention";
import { contractSignalOf, type HookEvent } from "../lib/agent-signal-map";

function setup() {
  let now = 100_000;
  const tracker = createAgentAttentionTracker({ now: () => now });
  tracker.noteProcess(1, "codex", true);
  const send = (event: string, turnId = "turn-1", sessionId = "session-1") => {
    const signal = contractSignalOf({
      paneId: 1,
      source: "hook",
      agent: "codex",
      event,
      turnId,
      sessionId,
      cwd: "/repo",
      message: "Finished.",
      detail: null,
      receivedAt: ++now,
    } as HookEvent);
    return signal === null ? null : tracker.noteContract(1, signal);
  };
  const redraw = () =>
    tracker.noteActivity(1, {
      phase: "working",
      source: "output-heuristic",
      severity: null,
      oscState: null,
      observedAt: ++now,
      evidenceStartedAt: now,
    });
  return {
    tracker,
    send,
    redraw,
    advance: (ms: number) => {
      now += ms;
      tracker.tick(now);
    },
  };
}

describe("Codex lifecycle", () => {
  it("clears working on interruption without reporting completion", () => {
    const { tracker, send, redraw } = setup();
    send("UserPromptSubmit");
    send("Interrupt");
    redraw();
    expect(tracker.snapshot(1)).toMatchObject({ phase: "idle", attention: "none", hasRun: false });
    send("UserPromptSubmit", "turn-2");
    expect(tracker.snapshot(1)?.phase).toBe("working");
  });

  it("finishes explicitly and stays idle through redraw, acknowledgement and freshness expiry", () => {
    const { tracker, send, redraw, advance } = setup();
    send("UserPromptSubmit");
    expect(tracker.snapshot(1)?.phase).toBe("working");
    send("Stop");
    expect(tracker.snapshot(1)).toMatchObject({ phase: "idle", attention: "completed" });
    tracker.acknowledge(1);
    advance(180_000);
    for (let i = 0; i < 60; i++) redraw();
    expect(tracker.snapshot(1)).toMatchObject({ phase: "idle", attention: "none", hasRun: true });
    send("UserPromptSubmit", "turn-2");
    expect(tracker.snapshot(1)?.phase).toBe("working");
  });

  it("ignores an old completion and a replayed prompt after a newer turn starts", () => {
    const { tracker, send } = setup();
    send("UserPromptSubmit");
    send("Stop");
    send("UserPromptSubmit", "turn-2");
    send("Stop", "turn-1");
    send("UserPromptSubmit", "turn-1");
    expect(tracker.snapshot(1)?.phase).toBe("working");
    send("Stop", "turn-2");
    send("UserPromptSubmit", "turn-2");
    expect(tracker.snapshot(1)?.phase).toBe("idle");
  });

  it("accepts completion when start was missed, but rejects another session and subagent events", () => {
    const { tracker, send } = setup();
    send("Stop");
    expect(tracker.snapshot(1)?.phase).toBe("idle");
    send("UserPromptSubmit", "turn-2");
    send("Stop", "turn-2", "previous-session");
    send("SubagentStop", "turn-2");
    expect(tracker.snapshot(1)?.phase).toBe("working");
  });

  it("does not let heuristic silence finish an explicit active turn", () => {
    const { tracker, send } = setup();
    send("UserPromptSubmit");
    tracker.noteActivity(1, {
      phase: "idle",
      source: "output-heuristic",
      severity: null,
      oscState: null,
      observedAt: 110_000,
    });
    expect(tracker.snapshot(1)?.phase).toBe("working");
  });
});
