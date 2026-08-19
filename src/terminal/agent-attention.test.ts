import { describe, expect, it } from "vitest";
import {
  createAgentAttentionTracker,
  type AgentAttentionTracker,
  type AttentionSignal,
} from "./agent-attention";
import type { ActivitySeverity, ActivityTransition } from "./agent-activity";

/** Tracker over a hand-cranked clock. */
function setup(): {
  tracker: AgentAttentionTracker;
  clock: { t: number };
} {
  const clock = { t: 1_000 };
  const tracker = createAgentAttentionTracker({ now: () => clock.t });
  return { tracker, clock };
}

function oscWorking(
  observedAt: number,
  severity: ActivitySeverity = null,
  oscState = 1,
): ActivityTransition {
  return {
    phase: "working",
    source: "osc-progress",
    severity,
    oscState,
    observedAt,
  };
}

function oscIdle(observedAt: number): ActivityTransition {
  return {
    phase: "idle",
    source: "osc-progress",
    severity: null,
    oscState: 0,
    observedAt,
  };
}

function fallbackWorking(observedAt: number, evidenceStartedAt: number): ActivityTransition {
  return {
    phase: "working",
    source: "output-heuristic",
    severity: null,
    oscState: null,
    observedAt,
    evidenceStartedAt,
  };
}

function fallbackIdle(observedAt: number, evidenceStartedAt: number): ActivityTransition {
  return {
    phase: "idle",
    source: "output-heuristic",
    severity: null,
    oscState: null,
    observedAt,
    evidenceStartedAt,
  };
}

function requested(
  observedAt: number,
  source: "osc-notification" | "bell" = "osc-notification",
): AttentionSignal {
  return { kind: "requested", source, observedAt };
}

describe("AgentAttentionTracker — completion", () => {
  it("working → idle latches completed (explicit, osc-progress)", () => {
    const { tracker, clock } = setup();
    tracker.noteProcess(1, "claude", true);
    tracker.noteActivity(1, oscWorking(clock.t));
    expect(tracker.snapshot(1)?.phase).toBe("working");
    const snap = tracker.noteActivity(1, oscIdle(clock.t));
    expect(snap?.phase).toBe("idle");
    expect(snap?.attention).toBe("completed");
    expect(snap?.source).toBe("osc-progress");
    expect(snap?.confidence).toBe("explicit");
  });

  it("clear with no prior working is just idle, no completion", () => {
    const { tracker, clock } = setup();
    tracker.noteProcess(1, "claude", true);
    const snap = tracker.noteActivity(1, oscIdle(clock.t));
    expect(snap?.phase).toBe("idle");
    expect(snap?.attention).toBe("none");
  });

  it("a lone fallback repaint never completes (no working streak)", () => {
    // The upstream fallback only emits an idle transition after a real streak;
    // here we never feed a working transition, so an idle fallback must not
    // manufacture a completion.
    const { tracker, clock } = setup();
    tracker.noteProcess(1, "claude", true);
    const snap = tracker.noteActivity(1, fallbackIdle(clock.t, clock.t));
    expect(snap?.attention ?? "none").toBe("none");
    expect(tracker.snapshot(1)?.attention).toBe("none");
  });

  it("a new working streak self-clears a stale completed", () => {
    const { tracker, clock } = setup();
    tracker.noteProcess(1, "claude", true);
    tracker.noteActivity(1, oscWorking(clock.t));
    tracker.noteActivity(1, oscIdle(clock.t));
    expect(tracker.snapshot(1)?.attention).toBe("completed");
    const snap = tracker.noteActivity(1, oscWorking(clock.t));
    expect(snap?.phase).toBe("working");
    expect(snap?.attention).toBe("none");
  });

  it("a latched requested survives a new working streak", () => {
    const { tracker, clock } = setup();
    tracker.noteProcess(1, "claude", true);
    tracker.noteSignal(1, requested(clock.t));
    expect(tracker.snapshot(1)?.attention).toBe("requested");
    const snap = tracker.noteActivity(1, oscWorking(clock.t));
    expect(snap?.phase).toBe("working");
    expect(tracker.snapshot(1)?.attention).toBe("requested");
  });
});

describe("AgentAttentionTracker — latching", () => {
  it("OSC 9;4 error (state 2) latches error while phase is working", () => {
    const { tracker, clock } = setup();
    tracker.noteProcess(1, "claude", true);
    const snap = tracker.noteActivity(1, oscWorking(clock.t, "error", 2));
    expect(snap?.phase).toBe("working");
    expect(snap?.attention).toBe("error");
    expect(snap?.source).toBe("osc-progress");
  });

  it("warning/error survive an OSC clear (idle ends phase, not the latch)", () => {
    const { tracker, clock } = setup();
    tracker.noteProcess(1, "claude", true);
    tracker.noteActivity(1, oscWorking(clock.t, "error", 2));
    const snap = tracker.noteActivity(1, oscIdle(clock.t));
    expect(snap?.phase).toBe("idle");
    expect(snap?.attention).toBe("error");
  });

  it("severity precedence: error not downgraded by a later warning/requested", () => {
    const { tracker, clock } = setup();
    tracker.noteProcess(1, "claude", true);
    tracker.noteActivity(1, oscWorking(clock.t, "warning", 4));
    expect(tracker.snapshot(1)?.attention).toBe("warning");
    tracker.noteActivity(1, oscWorking(clock.t, "error", 2));
    expect(tracker.snapshot(1)?.attention).toBe("error");
    tracker.noteActivity(1, oscWorking(clock.t, "warning", 4));
    expect(tracker.snapshot(1)?.attention).toBe("error");
    tracker.noteSignal(1, requested(clock.t));
    expect(tracker.snapshot(1)?.attention).toBe("error");
  });

  it("requested outranks completed", () => {
    const { tracker, clock } = setup();
    tracker.noteProcess(1, "claude", true);
    tracker.noteActivity(1, oscWorking(clock.t));
    tracker.noteActivity(1, oscIdle(clock.t));
    expect(tracker.snapshot(1)?.attention).toBe("completed");
    tracker.noteSignal(1, requested(clock.t));
    expect(tracker.snapshot(1)?.attention).toBe("requested");
  });
});

describe("AgentAttentionTracker — acknowledge", () => {
  it("acknowledge clears attention + unread but keeps working phase", () => {
    const { tracker, clock } = setup();
    tracker.noteProcess(1, "claude", true);
    tracker.noteActivity(1, oscWorking(clock.t, "error", 2));
    tracker.noteOutputVisibility(1, false);
    expect(tracker.snapshot(1)?.unread).toBe(true);
    const snap = tracker.acknowledge(1);
    expect(snap?.attention).toBe("none");
    expect(snap?.unread).toBe(false);
    expect(snap?.phase).toBe("working");
  });

  it("acknowledge on a clean pane is a no-op (null)", () => {
    const { tracker } = setup();
    tracker.noteProcess(1, "claude", true);
    expect(tracker.acknowledge(1)).toBeNull();
  });
});

describe("AgentAttentionTracker — per-pane unread", () => {
  it("output while not visible sets unread; needs no agent gate", () => {
    const { tracker } = setup();
    const snap = tracker.noteOutputVisibility(1, false);
    expect(snap?.unread).toBe(true);
  });

  it("output while visible never sets unread", () => {
    const { tracker } = setup();
    expect(tracker.noteOutputVisibility(1, true)).toBeNull();
    expect(tracker.snapshot(1)?.unread).toBe(false);
  });

  it("two panes keep independent unread", () => {
    const { tracker } = setup();
    tracker.noteOutputVisibility(1, false);
    tracker.noteOutputVisibility(2, true);
    expect(tracker.snapshot(1)?.unread).toBe(true);
    expect(tracker.snapshot(2)?.unread).toBe(false);
  });

  it("process change does not reset per-pane unread", () => {
    const { tracker } = setup();
    tracker.noteOutputVisibility(1, false);
    tracker.noteProcess(1, "claude", true);
    expect(tracker.snapshot(1)?.unread).toBe(true);
    tracker.noteProcess(1, "zsh", false);
    expect(tracker.snapshot(1)?.unread).toBe(true);
  });

  it("making the pane visible again preserves a prior unread — only acknowledge clears it", () => {
    const { tracker } = setup();
    tracker.noteProcess(1, "claude", true);
    tracker.noteOutputVisibility(1, false);
    expect(tracker.snapshot(1)?.unread).toBe(true);
    tracker.noteOutputVisibility(1, true);
    expect(tracker.snapshot(1)?.unread).toBe(true);
  });
});

describe("AgentAttentionTracker — exit & prune", () => {
  it("noteExit sets phase exited", () => {
    const { tracker, clock } = setup();
    tracker.noteProcess(1, "claude", true);
    tracker.noteActivity(1, oscWorking(clock.t));
    const snap = tracker.noteExit(1);
    expect(snap?.phase).toBe("exited");
  });

  it("prune forgets panes not in the live set", () => {
    const { tracker } = setup();
    tracker.noteProcess(1, "claude", true);
    tracker.noteProcess(2, "claude", true);
    tracker.prune([2]);
    expect(tracker.snapshot(1)).toBeNull();
    expect(tracker.snapshot(2)).not.toBeNull();
  });

  it("snapshot of a pane never seen is null", () => {
    const { tracker } = setup();
    expect(tracker.snapshot(999)).toBeNull();
  });
});

describe("AgentAttentionTracker — process gate", () => {
  it.each(["claude", "node"])(
    "does not trust an agent-looking %s label without an explicit agent classification",
    (process) => {
      const { tracker, clock } = setup();
      tracker.noteProcess(1, process, false);

      expect(tracker.noteActivity(1, oscWorking(clock.t))).toBeNull();
      expect(tracker.noteSignal(1, requested(clock.t))).toBeNull();
      expect(tracker.snapshot(1)?.attention).toBe("none");
      expect(tracker.snapshot(1)?.phase).toBe("unknown");
    },
  );

  it("shell OSC 9;4 warning/error is ignored", () => {
    const { tracker, clock } = setup();
    tracker.noteProcess(1, "zsh", false);
    expect(tracker.noteActivity(1, oscWorking(clock.t, "error", 2))).toBeNull();
    expect(tracker.noteActivity(1, oscWorking(clock.t, "warning", 4))).toBeNull();
    expect(tracker.snapshot(1)?.attention).toBe("none");
    expect(tracker.snapshot(1)?.phase).toBe("unknown");
  });

  it("shell sustained output (fallback) is ignored", () => {
    const { tracker, clock } = setup();
    tracker.noteProcess(1, "zsh", false);
    expect(tracker.noteActivity(1, fallbackWorking(clock.t, clock.t))).toBeNull();
    expect(tracker.snapshot(1)?.phase).toBe("unknown");
  });

  it("shell OSC notification / bell signal is ignored", () => {
    const { tracker, clock } = setup();
    tracker.noteProcess(1, "zsh", false);
    expect(tracker.noteSignal(1, requested(clock.t, "bell"))).toBeNull();
    expect(tracker.snapshot(1)?.attention).toBe("none");
  });

  it("pre-poll activity/signal is ignored and NOT replayed after the poll opens the gate", () => {
    const { tracker, clock } = setup();
    // Before any poll: no record exists, everything ignored.
    expect(tracker.noteActivity(1, oscWorking(clock.t))).toBeNull();
    expect(tracker.noteSignal(1, requested(clock.t))).toBeNull();
    expect(tracker.snapshot(1)).toBeNull();
    // Poll opens the gate — it must NOT replay the pre-poll working/requested.
    clock.t = 2_000;
    tracker.noteProcess(1, "claude", true);
    expect(tracker.snapshot(1)?.phase).toBe("unknown");
    expect(tracker.snapshot(1)?.attention).toBe("none");
    // A fresh transition after the gate IS accepted.
    const snap = tracker.noteActivity(1, oscWorking(clock.t));
    expect(snap?.phase).toBe("working");
  });

  it("a fallback streak that began before the gate is ignored after the poll", () => {
    const clock = { t: 5_000 };
    const t = createAgentAttentionTracker({ now: () => clock.t });
    t.noteProcess(1, "claude", true); // gateOpenedAt = 5000
    // Streak began at 4000 (< gate), tail flips working at 5001 (>= gate):
    expect(t.noteActivity(1, fallbackWorking(5_001, 4_000))).toBeNull();
    expect(t.snapshot(1)?.phase).toBe("unknown");
  });

  it("recognized-agent new activity and signal are accepted", () => {
    const { tracker, clock } = setup();
    tracker.noteProcess(1, "claude", true);
    expect(tracker.noteActivity(1, oscWorking(clock.t))?.phase).toBe("working");
    expect(tracker.noteSignal(1, requested(clock.t))?.attention).toBe("requested");
  });

  it("working agent → shell emits exactly one inferred completion, then closes the gate", () => {
    const { tracker, clock } = setup();
    tracker.noteProcess(1, "claude", true);
    tracker.noteActivity(1, oscWorking(clock.t));
    clock.t = 2_000;
    const snap = tracker.noteProcess(1, "zsh", false);
    expect(snap?.phase).toBe("idle");
    expect(snap?.attention).toBe("completed");
    expect(snap?.source).toBe("process");
    expect(snap?.confidence).toBe("inferred");
    const rev = snap?.revision;
    // A repeated shell poll must not emit a second completion.
    expect(tracker.noteProcess(1, "zsh", false)).toBeNull();
    expect(tracker.snapshot(1)?.revision).toBe(rev);
  });

  it("idle agent → shell emits no completion", () => {
    const { tracker, clock } = setup();
    tracker.noteProcess(1, "claude", true);
    tracker.noteActivity(1, oscIdle(clock.t)); // idle, never worked
    tracker.noteProcess(1, "zsh", false);
    expect(tracker.snapshot(1)?.attention).toBe("none");
    expect(tracker.snapshot(1)?.phase).toBe("idle");
  });

  it("existing error is not downgraded by the agent → shell completion", () => {
    const { tracker, clock } = setup();
    tracker.noteProcess(1, "claude", true);
    tracker.noteActivity(1, oscWorking(clock.t, "error", 2));
    const snap = tracker.noteProcess(1, "zsh", false);
    expect(snap?.phase).toBe("idle");
    expect(snap?.attention).toBe("error");
  });

  it("every activity/signal after the gate closes is ignored", () => {
    const { tracker, clock } = setup();
    tracker.noteProcess(1, "claude", true);
    tracker.noteActivity(1, oscWorking(clock.t));
    tracker.noteProcess(1, "zsh", false); // closes gate (completes)
    expect(tracker.noteActivity(1, oscWorking(clock.t))).toBeNull();
    expect(tracker.noteSignal(1, requested(clock.t))).toBeNull();
    expect(tracker.snapshot(1)?.attention).toBe("completed");
    expect(tracker.snapshot(1)?.phase).toBe("idle");
  });
});

describe("AgentAttentionTracker — process transitions", () => {
  it("agent → agent (different label) resets phase + signal-derived attention, no completion, keeps unread", () => {
    const { tracker, clock } = setup();
    tracker.noteProcess(1, "claude", true);
    tracker.noteActivity(1, oscWorking(clock.t, "error", 2));
    tracker.noteOutputVisibility(1, false);
    const snap = tracker.noteProcess(1, "codex", true);
    expect(snap?.phase).toBe("unknown");
    expect(snap?.attention).toBe("none");
    expect(snap?.agentLabel).toBe("codex");
    expect(snap?.unread).toBe(true); // unread survives a process change
  });

  it("same-name re-poll is a no-op — the tracker cannot detect a same-name restart", () => {
    const { tracker, clock } = setup();
    tracker.noteProcess(1, "claude", true);
    tracker.noteActivity(1, oscWorking(clock.t, "error", 2));
    const before = tracker.snapshot(1)?.revision;
    // The same agent "restarts" but the poll still reports "claude": the
    // tracker treats it as the same generation (documented limitation).
    expect(tracker.noteProcess(1, "claude", true)).toBeNull();
    expect(tracker.snapshot(1)?.revision).toBe(before);
    expect(tracker.snapshot(1)?.attention).toBe("error");
  });

  it("keeps the last recognized agent label after completion for post-completion copy", () => {
    const { tracker, clock } = setup();
    tracker.noteProcess(1, "claude", true);
    tracker.noteActivity(1, oscWorking(clock.t));
    const snap = tracker.noteProcess(1, "zsh", false);
    expect(snap?.agentLabel).toBe("claude");
  });
});

describe("AgentAttentionTracker — summarize", () => {
  it("kind is the single highest-precedence state across panes", () => {
    const { tracker, clock } = setup();
    // pane 1: error
    tracker.noteProcess(1, "claude", true);
    tracker.noteActivity(1, oscWorking(clock.t, "error", 2));
    // pane 2: working (plain)
    tracker.noteProcess(2, "claude", true);
    tracker.noteActivity(2, oscWorking(clock.t));
    // pane 3: unread only
    tracker.noteOutputVisibility(3, false);
    // pane 4: idle
    tracker.noteProcess(4, "claude", true);
    tracker.noteActivity(4, oscIdle(clock.t));

    const summary = tracker.summarize([1, 2, 3, 4]);
    expect(summary.kind).toBe("error");
    expect(summary.actionableCount).toBe(1); // only pane 1 has actionable attention
    expect(summary.workingCount).toBe(2); // pane 1 (error → still working phase) + pane 2
    expect(summary.unreadCount).toBe(1); // pane 3
  });

  it("empty / all-idle tab summarizes to idle", () => {
    const { tracker } = setup();
    expect(tracker.summarize([]).kind).toBe("idle");
  });

  it("counts a working pane that also carries a warning latch", () => {
    const { tracker, clock } = setup();
    tracker.noteProcess(1, "claude", true);
    tracker.noteActivity(1, oscWorking(clock.t, "warning", 4));
    const summary = tracker.summarize([1]);
    expect(summary.kind).toBe("warning");
    expect(summary.workingCount).toBe(1);
    expect(summary.actionableCount).toBe(1);
  });
});

describe("AgentAttentionTracker — actionable", () => {
  it("sorts by severity, then oldest changedAt first (stable)", () => {
    const clock = { t: 0 };
    const tracker = createAgentAttentionTracker({ now: () => clock.t });

    clock.t = 50;
    tracker.noteProcess(30, "claude", true);
    tracker.noteActivity(30, oscWorking(50, "error", 2)); // error @ 50

    clock.t = 100;
    tracker.noteProcess(10, "claude", true);
    tracker.noteActivity(10, oscWorking(100, "warning", 4)); // warning @ 100

    clock.t = 200;
    tracker.noteProcess(20, "claude", true);
    tracker.noteActivity(20, oscWorking(200, "warning", 4)); // warning @ 200

    const list = tracker.actionable();
    expect(list.map((c) => c.id)).toEqual([30, 10, 20]);
    expect(list.map((c) => c.kind)).toEqual(["error", "warning", "warning"]);
  });

  it("excludes panes with no actionable attention", () => {
    const { tracker, clock } = setup();
    tracker.noteProcess(1, "claude", true);
    tracker.noteActivity(1, oscWorking(clock.t)); // working, not actionable
    tracker.noteOutputVisibility(2, false); // unread, not actionable
    expect(tracker.actionable()).toEqual([]);
  });
});
