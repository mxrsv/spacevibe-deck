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
  it("noteExit sets phase exited and records the exit status", () => {
    const { tracker, clock } = setup();
    tracker.noteProcess(1, "claude", true);
    tracker.noteActivity(1, oscWorking(clock.t));
    const snap = tracker.noteExit(1, 137);
    expect(snap?.phase).toBe("exited");
    expect(snap?.exitCode).toBe(137);
    expect(snap?.phaseConfidence).toBe("explicit");
  });

  it("noteExit with no status (Tauri) records null, never a guessed zero", () => {
    const { tracker } = setup();
    tracker.noteProcess(1, "claude", true);
    expect(tracker.noteExit(1)?.exitCode).toBeNull();
    tracker.noteProcess(2, "claude", true);
    expect(tracker.noteExit(2, Number.NaN)?.exitCode).toBeNull();
  });

  it("noteExit on a working agent ENDS it: the run's completed latch goes, an error stays", () => {
    const { tracker, clock } = setup();
    tracker.noteProcess(1, "claude", true);
    tracker.noteActivity(1, oscWorking(clock.t));
    tracker.noteActivity(1, oscIdle(clock.t)); // completed, explicit
    const ended = tracker.noteExit(1, 0);
    expect(ended?.attention).toBe("none");
    expect(ended?.phase).toBe("exited");

    tracker.noteProcess(2, "claude", true);
    tracker.noteActivity(2, oscWorking(clock.t, "error", 2));
    expect(tracker.noteExit(2, 1)?.attention).toBe("error");
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

  // Agent-signal contract layer, stage 0 (2026-09-03): before this, a working
  // agent leaving the foreground latched an INFERRED `completed`, so a crash
  // wore the same yellow as a finished run (trust audit §4.3). It ends now.
  it("working agent → shell ENDS the agent: phase exited, no completion, then closes the gate", () => {
    const { tracker, clock } = setup();
    tracker.noteProcess(1, "claude", true);
    tracker.noteActivity(1, oscWorking(clock.t));
    clock.t = 2_000;
    const snap = tracker.noteProcess(1, "zsh", false);
    expect(snap?.phase).toBe("exited");
    expect(snap?.attention).toBe("none");
    expect(snap?.source).toBeNull();
    expect(snap?.phaseConfidence).toBe("explicit");
    expect(snap?.exitCode).toBeNull();
    const rev = snap?.revision;
    // A repeated shell poll must not re-emit the end.
    expect(tracker.noteProcess(1, "zsh", false)).toBeNull();
    expect(tracker.snapshot(1)?.revision).toBe(rev);
  });

  it("idle agent → shell ends the agent too, with nothing latched", () => {
    const { tracker, clock } = setup();
    tracker.noteProcess(1, "claude", true);
    tracker.noteActivity(1, oscIdle(clock.t)); // idle, never worked
    tracker.noteProcess(1, "zsh", false);
    expect(tracker.snapshot(1)?.attention).toBe("none");
    expect(tracker.snapshot(1)?.phase).toBe("exited");
  });

  it("agent → shell clears a requested or completed latch — a dead agent never reads as asked", () => {
    const { tracker, clock } = setup();
    tracker.noteProcess(1, "claude", true);
    tracker.noteSignal(1, requested(clock.t));
    expect(tracker.noteProcess(1, "zsh", false)?.attention).toBe("none");

    tracker.noteProcess(2, "claude", true);
    tracker.noteActivity(2, oscWorking(clock.t));
    tracker.noteActivity(2, oscIdle(clock.t)); // explicit completed
    expect(tracker.noteProcess(2, "zsh", false)?.attention).toBe("none");
  });

  it("an existing error or warning survives the agent → shell end", () => {
    const { tracker, clock } = setup();
    tracker.noteProcess(1, "claude", true);
    tracker.noteActivity(1, oscWorking(clock.t, "error", 2));
    const snap = tracker.noteProcess(1, "zsh", false);
    expect(snap?.phase).toBe("exited");
    expect(snap?.attention).toBe("error");

    tracker.noteProcess(2, "claude", true);
    tracker.noteActivity(2, oscWorking(clock.t, "warning", 4));
    expect(tracker.noteProcess(2, "zsh", false)?.attention).toBe("warning");
  });

  it("acknowledge clears an ended agent back to an idle shell", () => {
    const { tracker, clock } = setup();
    tracker.noteProcess(1, "claude", true);
    tracker.noteActivity(1, oscWorking(clock.t));
    tracker.noteProcess(1, "zsh", false);
    const snap = tracker.acknowledge(1);
    expect(snap?.phase).toBe("idle");
    // The name goes with the checked end (see the shell-exit test below).
    expect(snap?.agentLabel).toBeNull();
  });

  it("visible output clears an ended agent, hidden output does not", () => {
    const { tracker, clock } = setup();
    tracker.noteProcess(1, "claude", true);
    tracker.noteActivity(1, oscWorking(clock.t));
    tracker.noteProcess(1, "zsh", false);
    expect(tracker.noteOutputVisibility(1, false)?.unread).toBe(true);
    expect(tracker.snapshot(1)?.phase).toBe("exited");
    expect(tracker.noteOutputVisibility(1, true)?.phase).toBe("idle");
  });

  it("a checked end drops the agent's name, so the shell's own later exit cannot reprint it", () => {
    const { tracker, clock } = setup();
    tracker.noteProcess(1, "claude", true);
    tracker.noteActivity(1, oscWorking(clock.t));
    tracker.noteProcess(1, "zsh", false); // ended
    expect(tracker.snapshot(1)?.agentLabel).toBe("claude");
    tracker.acknowledge(1); // checked
    expect(tracker.snapshot(1)?.agentLabel).toBeNull();
    // An hour later the shell itself dies: exited, but nobody's agent.
    const shellExit = tracker.noteExit(1, 0);
    expect(shellExit?.phase).toBe("exited");
    expect(shellExit?.agentLabel).toBeNull();
  });

  it("acknowledge never un-ends a pane whose agent is still in the foreground", () => {
    const { tracker, clock } = setup();
    tracker.noteProcess(1, "claude", true);
    tracker.noteActivity(1, oscWorking(clock.t));
    expect(tracker.acknowledge(1)).toBeNull();
    expect(tracker.snapshot(1)?.phase).toBe("working");
  });

  it("every activity/signal after the gate closes is ignored", () => {
    const { tracker, clock } = setup();
    tracker.noteProcess(1, "claude", true);
    tracker.noteActivity(1, oscWorking(clock.t));
    tracker.noteProcess(1, "zsh", false); // closes gate (ends)
    expect(tracker.noteActivity(1, oscWorking(clock.t))).toBeNull();
    expect(tracker.noteSignal(1, requested(clock.t))).toBeNull();
    expect(tracker.snapshot(1)?.attention).toBe("none");
    expect(tracker.snapshot(1)?.phase).toBe("exited");
  });
});

describe("AgentAttentionTracker — gate seed (trust audit §4.5, 2026-09-03)", () => {
  const oscSnapshot = (phase: "working" | "idle") =>
    ({
      phase,
      source: "osc-progress" as const,
      severity: null,
      oscState: phase === "working" ? 3 : 0,
    }) as const;

  it("an OSC-backed working snapshot at gate-open seeds working + hasRun", () => {
    const { tracker } = setup();
    const snap = tracker.noteProcess(1, "claude", true, oscSnapshot("working"));
    expect(snap?.phase).toBe("working");
    expect(snap?.hasRun).toBe(true);
    expect(snap?.phaseConfidence).toBe("explicit");
  });

  it("an OSC-backed idle snapshot at gate-open seeds idle, so a launch is ready at once", () => {
    const { tracker } = setup();
    const snap = tracker.noteProcess(1, "claude", true, oscSnapshot("idle"));
    expect(snap?.phase).toBe("idle");
    expect(snap?.hasRun).toBe(false);
    expect(snap?.attention).toBe("none");
  });

  it("a seeded working pane completes on its later OSC clear", () => {
    const { tracker, clock } = setup();
    tracker.noteProcess(1, "claude", true, oscSnapshot("working"));
    clock.t = 5_000;
    const snap = tracker.noteActivity(1, oscIdle(clock.t));
    expect(snap?.attention).toBe("completed");
    expect(snap?.confidence).toBe("explicit");
  });

  it("a heuristic snapshot seeds NOTHING — the startup screen is not a run", () => {
    const { tracker } = setup();
    const snap = tracker.noteProcess(1, "claude", true, {
      phase: "working",
      source: "output-heuristic",
      severity: null,
      oscState: null,
    });
    expect(snap?.phase).toBe("unknown");
    expect(snap?.hasRun).toBe(false);
    expect(snap?.phaseConfidence).toBe("unknown");
  });

  it("an unknown snapshot seeds nothing either", () => {
    const { tracker } = setup();
    const snap = tracker.noteProcess(1, "claude", true, {
      phase: "unknown",
      source: null,
      severity: null,
      oscState: null,
    });
    expect(snap?.phase).toBe("unknown");
  });

  it("agent → agent takes the seed as well", () => {
    const { tracker, clock } = setup();
    tracker.noteProcess(1, "claude", true);
    tracker.noteActivity(1, oscWorking(clock.t));
    const snap = tracker.noteProcess(1, "codex", true, oscSnapshot("idle"));
    expect(snap?.phase).toBe("idle");
    expect(snap?.agentLabel).toBe("codex");
  });
});

describe("AgentAttentionTracker — phase confidence (DL-27.3, 2026-09-03)", () => {
  it("starts unknown, and stays unknown until a signal arrives", () => {
    const { tracker } = setup();
    expect(tracker.noteProcess(1, "claude", true)?.phaseConfidence).toBe("unknown");
  });

  it("OSC 9;4 makes working and the later idle explicit", () => {
    const { tracker, clock } = setup();
    tracker.noteProcess(1, "claude", true);
    expect(tracker.noteActivity(1, oscWorking(clock.t))?.phaseConfidence).toBe("explicit");
    const done = tracker.noteActivity(1, oscIdle(clock.t));
    expect(done?.phaseConfidence).toBe("explicit");
    expect(done?.confidence).toBe("explicit");
  });

  it("the output heuristic makes working and the completion inferred, and acknowledge keeps that", () => {
    const { tracker, clock } = setup();
    tracker.noteProcess(1, "claude", true);
    const working = tracker.noteActivity(1, fallbackWorking(clock.t + 1_000, clock.t + 500));
    expect(working?.phaseConfidence).toBe("inferred");
    const done = tracker.noteActivity(1, fallbackIdle(clock.t + 5_000, clock.t + 500));
    expect(done?.confidence).toBe("inferred");
    expect(done?.phaseConfidence).toBe("inferred");
    // A checked run is `done`; the rail still needs to know it was inferred.
    const checked = tracker.acknowledge(1);
    expect(checked?.attention).toBe("none");
    expect(checked?.phaseConfidence).toBe("inferred");
  });

  it("a change in phase confidence alone is a visible change", () => {
    const { tracker, clock } = setup();
    tracker.noteProcess(1, "claude", true);
    tracker.noteActivity(1, fallbackWorking(clock.t + 1_000, clock.t + 500));
    // Same phase, better evidence: the row's mark fills in.
    expect(tracker.noteActivity(1, oscWorking(clock.t + 2_000))?.phaseConfidence).toBe("explicit");
  });
});

describe("AgentAttentionTracker — the Claude registry (stage 1, 2026-09-03)", () => {
  const waiting = { sessionId: "s-1", waiting: true, detail: "permission prompt" };
  const idle = { sessionId: "s-1", waiting: false, detail: null };

  it("records the session as a fact and latches an explicit requested with its detail", () => {
    const { tracker } = setup();
    tracker.noteProcess(1, "claude", true);
    const snap = tracker.noteRegistry(1, waiting);
    expect(snap?.sessionId).toBe("s-1");
    expect(snap?.attention).toBe("requested");
    expect(snap?.source).toBe("registry");
    expect(snap?.confidence).toBe("explicit");
    expect(snap?.detail).toBe("permission prompt");
  });

  it("a fact that is no longer waiting clears the registry's own requested, and nothing else", () => {
    const { tracker, clock } = setup();
    tracker.noteProcess(1, "claude", true);
    tracker.noteRegistry(1, waiting);
    const cleared = tracker.noteRegistry(1, idle);
    expect(cleared?.attention).toBe("none");
    expect(cleared?.detail).toBeNull();
    expect(cleared?.sessionId).toBe("s-1");

    // A BEL's requested is a one-shot signal with no "no longer" — it stays.
    tracker.noteProcess(2, "claude", true);
    tracker.noteSignal(2, requested(clock.t, "bell"));
    tracker.noteRegistry(2, idle);
    expect(tracker.snapshot(2)?.attention).toBe("requested");
    expect(tracker.snapshot(2)?.source).toBe("bell");
  });

  it("never downgrades a latched error, but keeps the session", () => {
    const { tracker, clock } = setup();
    tracker.noteProcess(1, "claude", true);
    tracker.noteActivity(1, oscWorking(clock.t, "error", 2));
    const snap = tracker.noteRegistry(1, waiting);
    expect(snap?.attention).toBe("error");
    expect(snap?.detail).toBeNull();
    expect(snap?.sessionId).toBe("s-1");
  });

  it("is gated: a pane that is not an agent takes no fact", () => {
    const { tracker } = setup();
    tracker.noteProcess(1, "zsh", false);
    expect(tracker.noteRegistry(1, waiting)).toBeNull();
    expect(tracker.noteRegistry(99, waiting)).toBeNull();
    expect(tracker.snapshot(1)?.sessionId).toBeNull();
  });

  it("an absent fact withdraws the registry's requested and forgets the session", () => {
    const { tracker } = setup();
    tracker.noteProcess(1, "claude", true);
    tracker.noteRegistry(1, waiting);
    const gone = tracker.noteRegistry(1, null);
    expect(gone?.attention).toBe("none");
    expect(gone?.sessionId).toBeNull();
  });

  it("a repeated identical fact is not a visible change", () => {
    const { tracker } = setup();
    tracker.noteProcess(1, "claude", true);
    tracker.noteRegistry(1, waiting);
    const rev = tracker.snapshot(1)?.revision;
    expect(tracker.noteRegistry(1, waiting)).toBeNull();
    expect(tracker.snapshot(1)?.revision).toBe(rev);
  });

  it("the session is reset with the gate, and kept across the agent's end", () => {
    const { tracker, clock } = setup();
    tracker.noteProcess(1, "claude", true);
    tracker.noteRegistry(1, waiting);
    // A new occupant: a different agent in the same pane.
    expect(tracker.noteProcess(1, "codex", true)?.sessionId).toBeNull();

    tracker.noteProcess(2, "claude", true);
    tracker.noteActivity(2, oscWorking(clock.t));
    tracker.noteRegistry(2, waiting);
    const ended = tracker.noteProcess(2, "zsh", false);
    // The requested it was waiting on goes with the agent; the id stays for
    // the journal, which resumes exactly this conversation.
    expect(ended?.attention).toBe("none");
    expect(ended?.detail).toBeNull();
    expect(ended?.sessionId).toBe("s-1");
    // ...and a fresh agent in that pane starts without it.
    expect(tracker.noteProcess(2, "claude", true)?.sessionId).toBeNull();
  });

  it("acknowledge clears the detail with the latch", () => {
    const { tracker } = setup();
    tracker.noteProcess(1, "claude", true);
    tracker.noteRegistry(1, waiting);
    const acked = tracker.acknowledge(1);
    expect(acked?.attention).toBe("none");
    expect(acked?.detail).toBeNull();
    expect(acked?.sessionId).toBe("s-1");
  });
});

describe("AgentAttentionTracker — contract signals (stage 2/3, 2026-09-03)", () => {
  const hook = (
    kind: "session" | "working" | "completed" | "requested" | "answered" | "error",
    over: Partial<{
      sessionId: string;
      detail: string | null;
      message: string | null;
      observedAt: number;
      source: "hook" | "server";
    }> = {},
  ) => ({
    source: "hook" as const,
    kind,
    sessionId: "s-1",
    detail: null,
    message: null,
    observedAt: 1_000,
    ...over,
  });

  it("is gated: a shell pane takes no contract signal", () => {
    const { tracker } = setup();
    tracker.noteProcess(1, "zsh", false);
    expect(tracker.noteContract(1, hook("completed"))).toBeNull();
  });

  it("Stop completes explicitly with the hook as source, even when no working was seen", () => {
    const { tracker } = setup();
    tracker.noteProcess(1, "claude", true);
    const snap = tracker.noteContract(1, hook("completed", { message: "done." }));
    expect(snap?.attention).toBe("completed");
    expect(snap?.source).toBe("hook");
    expect(snap?.confidence).toBe("explicit");
    expect(snap?.phase).toBe("idle");
    expect(snap?.phaseConfidence).toBe("explicit");
    expect(snap?.hasRun).toBe(true);
    expect(snap?.sessionId).toBe("s-1");
  });

  it("a requested from a hook carries its detail, and a Stop answers it", () => {
    const { tracker } = setup();
    tracker.noteProcess(1, "claude", true);
    const asked = tracker.noteContract(
      1,
      hook("requested", { detail: "permission prompt — Bash" }),
    );
    expect(asked?.attention).toBe("requested");
    expect(asked?.detail).toBe("permission prompt — Bash");
    const done = tracker.noteContract(1, hook("completed", { observedAt: 2_000 }));
    expect(done?.attention).toBe("completed");
    expect(done?.detail).toBeNull();
  });

  it("an error is the CLI's own failure and beats everything", () => {
    const { tracker } = setup();
    tracker.noteProcess(1, "claude", true);
    tracker.noteContract(1, hook("requested"));
    const failed = tracker.noteContract(1, hook("error", { detail: "ProviderAuthError" }));
    expect(failed?.attention).toBe("error");
    expect(failed?.detail).toBe("ProviderAuthError");
    // A later completion never downgrades it — and changes nothing visible.
    expect(tracker.noteContract(1, hook("completed"))).toBeNull();
    expect(tracker.snapshot(1)?.attention).toBe("error");
  });

  it("a server's working/idle drive the phase explicitly, and answered clears its own request", () => {
    const { tracker } = setup();
    tracker.noteProcess(1, "opencode", true);
    const working = tracker.noteContract(
      1,
      hook("working", { source: "server", sessionId: "ses_a" }),
    );
    expect(working?.phase).toBe("working");
    expect(working?.phaseConfidence).toBe("explicit");
    tracker.noteContract(
      1,
      hook("requested", { source: "server", sessionId: "ses_a", detail: "bash" }),
    );
    const answered = tracker.noteContract(
      1,
      hook("answered", { source: "server", sessionId: "ses_a" }),
    );
    expect(answered?.attention).toBe("none");
    const idle = tracker.noteContract(
      1,
      hook("completed", { source: "server", sessionId: "ses_a" }),
    );
    expect(idle?.phase).toBe("idle");
    expect(idle?.attention).toBe("completed");
  });

  it("a hook from a previous occupant is dropped; a server event rotates the session", () => {
    const { tracker } = setup();
    tracker.noteProcess(1, "claude", true);
    tracker.noteContract(1, hook("session", { sessionId: "s-1" }));
    expect(tracker.noteContract(1, hook("completed", { sessionId: "s-OLD" }))).toBeNull();
    expect(tracker.noteContract(1, hook("session", { sessionId: "s-2" }))?.sessionId).toBe("s-2");

    tracker.noteProcess(2, "opencode", true);
    tracker.noteContract(2, hook("working", { source: "server", sessionId: "ses_a" }));
    expect(
      tracker.noteContract(2, hook("completed", { source: "server", sessionId: "ses_b" }))
        ?.sessionId,
    ).toBe("ses_b");
  });

  it("a minted session becomes the pane's session when the gate opens, and only then", () => {
    const { tracker } = setup();
    tracker.noteMintedSession(1, "minted-1");
    expect(tracker.snapshot(1)?.sessionId).toBeNull();
    tracker.noteProcess(1, "zsh", false);
    expect(tracker.snapshot(1)?.sessionId).toBeNull();
    expect(tracker.noteProcess(1, "claude", true)?.sessionId).toBe("minted-1");
    // Spent: the next occupant does not inherit it.
    tracker.noteProcess(1, "zsh", false);
    expect(tracker.noteProcess(1, "claude", true)?.sessionId).toBeNull();
  });

  it("tick turns a stale contract state inferred and leaves a fresh one alone", () => {
    const { tracker } = setup();
    tracker.noteProcess(1, "claude", true);
    tracker.noteContract(1, hook("requested", { observedAt: 10_000 }));
    expect(tracker.tick(10_000 + 119_000)).toEqual([]);
    expect(tracker.tick(10_000 + 121_000)).toEqual([1]);
    const stale = tracker.snapshot(1);
    expect(stale?.attention).toBe("requested");
    expect(stale?.confidence).toBe("inferred");
    // Once degraded it is not degraded again.
    expect(tracker.tick(10_000 + 200_000)).toEqual([]);
    // A fresh signal restores the report.
    expect(tracker.noteContract(1, hook("requested", { observedAt: 300_000 }))?.confidence).toBe(
      "explicit",
    );
  });

  it("tick degrades a contract-set phase, but never one OSC set", () => {
    const { tracker, clock } = setup();
    tracker.noteProcess(1, "claude", true);
    tracker.noteContract(1, hook("working", { observedAt: 1_000 }));
    expect(tracker.tick(1_000 + 121_000)).toEqual([1]);
    expect(tracker.snapshot(1)?.phaseConfidence).toBe("inferred");

    tracker.noteProcess(2, "claude", true);
    tracker.noteContract(2, hook("session", { observedAt: 1_000 }));
    tracker.noteActivity(2, oscWorking(clock.t));
    expect(tracker.tick(1_000 + 121_000)).toEqual([]);
    expect(tracker.snapshot(2)?.phaseConfidence).toBe("explicit");
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
