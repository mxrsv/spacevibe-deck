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
      ...(event === "SessionStart" ? {} : { turnId }),
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
  it("keeps a resumed session idle before its first prompt, including late startup repaint", () => {
    const { tracker, send, redraw, advance } = setup();
    redraw();
    expect(tracker.snapshot(1)?.phase).toBe("working");
    send("SessionStart");
    expect(tracker.snapshot(1)).toMatchObject({
      phase: "idle",
      phaseConfidence: "explicit",
      attention: "none",
      hasRun: false,
    });
    advance(180_000);
    for (let i = 0; i < 60; i++) redraw();
    expect(tracker.snapshot(1)).toMatchObject({ phase: "idle", attention: "none", hasRun: false });
    send("UserPromptSubmit");
    expect(tracker.snapshot(1)?.phase).toBe("working");
    send("Stop");
    expect(tracker.snapshot(1)).toMatchObject({ phase: "idle", attention: "completed" });
  });

  it("does not rewind an active or completed turn when SessionStart is repeated", () => {
    const { tracker, send, redraw } = setup();
    send("UserPromptSubmit");
    send("SessionStart");
    expect(tracker.snapshot(1)?.phase).toBe("working");
    send("Stop");
    tracker.acknowledge(1);
    send("SessionStart");
    redraw();
    expect(tracker.snapshot(1)).toMatchObject({ phase: "idle", attention: "none", hasRun: true });
  });

  it("withdraws inferred startup completion without acknowledging unseen output", () => {
    const { tracker, send, redraw } = setup();
    tracker.noteOutputVisibility(1, false);
    redraw();
    tracker.noteActivity(1, {
      phase: "idle",
      source: "output-heuristic",
      severity: null,
      oscState: null,
      observedAt: 100_002,
    });
    expect(tracker.snapshot(1)?.attention).toBe("completed");
    send("SessionStart");
    expect(tracker.snapshot(1)).toMatchObject({
      phase: "idle",
      attention: "none",
      source: null,
      hasRun: false,
      unread: true,
    });
  });

  it("releases startup lifecycle when Signals is disabled or the agent exits", () => {
    const { tracker, send, redraw } = setup();
    send("SessionStart");
    tracker.releaseCodexLifecycle();
    redraw();
    expect(tracker.snapshot(1)?.phase).toBe("working");
    send("SessionStart");
    tracker.noteExit(1, 0);
    send("SessionStart");
    expect(tracker.snapshot(1)?.phase).toBe("exited");
    tracker.noteProcess(1, "codex", true);
    redraw();
    expect(tracker.snapshot(1)?.phase).toBe("working");
  });

  it("accepts the first completion after resume even when its prompt hook was missed", () => {
    const { tracker, send } = setup();
    send("SessionStart");
    send("Stop");
    expect(tracker.snapshot(1)).toMatchObject({ phase: "idle", attention: "completed" });
  });

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
