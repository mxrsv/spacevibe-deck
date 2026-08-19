import { describe, expect, it } from "vitest";
import { createAgentActivity, type AgentActivity } from "./agent-activity";

/** Tracker with a hand-cranked clock. */
function setup(): { activity: AgentActivity; tick: (ms: number) => void } {
  let clock = 1_000_000;
  const activity = createAgentActivity({ now: () => clock });
  return {
    activity,
    tick(ms) {
      clock += ms;
    },
  };
}

/** Sustained non-echo output: chunks every 200ms for `ms` total. */
function stream(
  activity: AgentActivity,
  tick: (ms: number) => void,
  paneId: number,
  ms: number,
): void {
  for (let elapsed = 0; elapsed <= ms; elapsed += 200) {
    activity.noteOutput(paneId, "tokens...");
    tick(200);
  }
}

describe("createAgentActivity — sustained-output fallback", () => {
  it("a sustained stream reads as working", () => {
    const { activity, tick } = setup();
    stream(activity, tick, 1, 600);
    expect(activity.working(1)).toBe(true);
  });

  it("a single isolated repaint (idle refresh) never counts", () => {
    const { activity, tick } = setup();
    activity.noteOutput(1, "status refresh");
    activity.noteOutput(1, "second chunk same instant");
    expect(activity.working(1)).toBe(false);
    tick(500);
    expect(activity.working(1)).toBe(false);
  });

  it("goes idle after recentMs of silence", () => {
    const { activity, tick } = setup();
    stream(activity, tick, 1, 600);
    tick(3001);
    expect(activity.working(1)).toBe(false);
  });

  it("a long gap starts a new streak — one blip after silence stays idle", () => {
    const { activity, tick } = setup();
    stream(activity, tick, 1, 600);
    tick(5000); // stream ended long ago
    activity.noteOutput(1, "isolated repaint");
    expect(activity.working(1)).toBe(false);
  });

  it("never marks a pane it has not seen output from", () => {
    const { activity } = setup();
    expect(activity.working(99)).toBe(false);
  });

  it("reports the working-state transition from noteOutput", () => {
    const { activity, tick } = setup();
    expect(activity.noteOutput(1, "a")).toBe(false); // isolated — still idle
    tick(500);
    expect(activity.noteOutput(1, "b")).toBe(true); // streak spans 500ms → working
  });
});

describe("createAgentActivity — echo suppression", () => {
  it("output right after a keystroke is echo, not work", () => {
    const { activity, tick } = setup();
    // Typing: keystroke → echo 100ms later, repeatedly. Never working.
    for (let i = 0; i < 10; i += 1) {
      activity.noteInput(1);
      tick(100);
      activity.noteOutput(1, "input box redraw");
      tick(400);
    }
    expect(activity.working(1)).toBe(false);
  });

  it("output well after the last keystroke counts again", () => {
    const { activity, tick } = setup();
    activity.noteInput(1);
    tick(400); // past the echo window
    stream(activity, tick, 1, 600);
    expect(activity.working(1)).toBe(true);
  });

  it("an OSC busy report inside the echo window still counts (Enter)", () => {
    const { activity, tick } = setup();
    activity.noteInput(1); // Enter
    tick(100);
    activity.noteOutput(1, "\x1b]9;4;3\x07redraw"); // busy report rides the echo
    expect(activity.working(1)).toBe(true);
  });
});

describe("createAgentActivity — OSC 9;4 progress reports", () => {
  it("a busy report keeps the pane working through silence", () => {
    const { activity, tick } = setup();
    activity.noteOutput(1, "\x1b]9;4;3\x07");
    tick(60_000); // network wait, no output — still thinking
    expect(activity.working(1)).toBe(true);
  });

  it("a clear report beats the sustained fallback", () => {
    const { activity, tick } = setup();
    activity.noteOutput(1, "\x1b]9;4;0\x07 done.");
    stream(activity, tick, 1, 800); // chatty but explicitly idle
    expect(activity.working(1)).toBe(false);
  });

  it("detects a report split across two PTY reads", () => {
    const { activity, tick } = setup();
    activity.noteOutput(1, "output\x1b]9;");
    activity.noteOutput(1, "4;3\x07more");
    tick(60_000);
    expect(activity.working(1)).toBe(true);
  });

  it("flags the working→idle transition on the clear report", () => {
    const { activity } = setup();
    activity.noteOutput(1, "\x1b]9;4;3\x07");
    expect(activity.noteOutput(1, "answer\x1b]9;4;0\x07")).toBe(true);
    expect(activity.working(1)).toBe(false);
  });
});

describe("createAgentActivity — process changes", () => {
  it("resets a stale OSC busy state when the pane's program changes", () => {
    const { activity } = setup();
    activity.noteProcess(1, "claude");
    activity.noteOutput(1, "\x1b]9;4;3\x07");
    expect(activity.working(1)).toBe(true);
    // Agent killed mid-run — no clear report ever arrives, shell comes back.
    activity.noteProcess(1, "zsh");
    expect(activity.working(1)).toBe(false);
  });

  it("keeps state while the process stays the same", () => {
    const { activity } = setup();
    activity.noteProcess(1, "claude");
    activity.noteOutput(1, "\x1b]9;4;3\x07");
    activity.noteProcess(1, "claude");
    expect(activity.working(1)).toBe(true);
  });
});

describe("createAgentActivity — prune", () => {
  it("forgets panes outside the live set", () => {
    const { activity } = setup();
    activity.noteOutput(1, "\x1b]9;4;3\x07");
    activity.noteOutput(2, "\x1b]9;4;3\x07");
    activity.prune([2]);
    expect(activity.working(1)).toBe(false);
    expect(activity.working(2)).toBe(true);
  });
});

describe("createAgentActivity — working() compatibility invariant", () => {
  it("is true for every non-zero oscState, including 2, 4, and unknown 7", () => {
    const { activity } = setup();
    activity.noteOutput(1, "\x1b]9;4;2\x07");
    activity.noteOutput(2, "\x1b]9;4;4\x07");
    activity.noteOutput(3, "\x1b]9;4;7\x07");
    expect(activity.working(1)).toBe(true);
    expect(activity.working(2)).toBe(true);
    expect(activity.working(3)).toBe(true);
  });
});

describe("createAgentActivity — noteOutputEvents", () => {
  it("state 2 (error) differs from state 4 (warning) in severity", () => {
    const { activity } = setup();
    const [errorTransition] = activity.noteOutputEvents(1, "\x1b]9;4;2\x07");
    const [warningTransition] = activity.noteOutputEvents(2, "\x1b]9;4;4\x07");
    expect(errorTransition).toMatchObject({
      phase: "working",
      source: "osc-progress",
      severity: "error",
      oscState: 2,
    });
    expect(warningTransition).toMatchObject({
      phase: "working",
      source: "osc-progress",
      severity: "warning",
      oscState: 4,
    });
  });

  it("keeps raw oscState 7 with severity null for an unknown non-zero state", () => {
    const { activity } = setup();
    const transitions = activity.noteOutputEvents(1, "\x1b]9;4;7\x07");
    expect(transitions).toEqual([
      {
        phase: "working",
        source: "osc-progress",
        severity: null,
        oscState: 7,
        observedAt: expect.any(Number),
      },
    ]);
    expect(activity.snapshot(1)).toEqual({
      phase: "working",
      source: "osc-progress",
      severity: null,
      oscState: 7,
    });
  });

  it("returns all three ordered transitions for working→error→clear in one chunk", () => {
    const { activity } = setup();
    const chunk = "\x1b]9;4;1\x07working\x1b]9;4;2\x07uh-oh\x1b]9;4;0\x07done";
    const transitions = activity.noteOutputEvents(1, chunk);
    expect(transitions).toEqual([
      {
        phase: "working",
        source: "osc-progress",
        severity: null,
        oscState: 1,
        observedAt: expect.any(Number),
      },
      {
        phase: "working",
        source: "osc-progress",
        severity: "error",
        oscState: 2,
        observedAt: expect.any(Number),
      },
      {
        phase: "idle",
        source: "osc-progress",
        severity: null,
        oscState: 0,
        observedAt: expect.any(Number),
      },
    ]);
  });

  it("a sustained fallback stream emits exactly one output-heuristic transition on the flip", () => {
    const { activity, tick } = setup();
    const flips: Array<ReturnType<AgentActivity["noteOutputEvents"]>> = [];
    for (let elapsed = 0; elapsed <= 600; elapsed += 200) {
      flips.push(activity.noteOutputEvents(1, "tokens..."));
      tick(200);
    }
    const nonEmpty = flips.filter((f) => f.length > 0);
    expect(nonEmpty).toHaveLength(1);
    expect(nonEmpty[0]).toEqual([
      {
        phase: "working",
        source: "output-heuristic",
        severity: null,
        oscState: null,
        observedAt: expect.any(Number),
        evidenceStartedAt: expect.any(Number),
      },
    ]);
    expect(activity.snapshot(1)).toEqual({
      phase: "working",
      source: "output-heuristic",
      severity: null,
      oscState: null,
    });
  });

  it("OSC beats fallback — a clear report overrides sustained plain output", () => {
    const { activity, tick } = setup();
    const first = activity.noteOutputEvents(1, "\x1b]9;4;0\x07 done.");
    expect(first).toEqual([
      {
        phase: "idle",
        source: "osc-progress",
        severity: null,
        oscState: 0,
        observedAt: expect.any(Number),
      },
    ]);
    for (let elapsed = 0; elapsed <= 800; elapsed += 200) {
      const events = activity.noteOutputEvents(1, "tokens...");
      expect(events).toEqual([]);
      tick(200);
    }
    expect(activity.snapshot(1)).toEqual({
      phase: "idle",
      source: "osc-progress",
      severity: null,
      oscState: 0,
    });
  });
});

describe("createAgentActivity — snapshot", () => {
  it("a pane with no signal yet has phase unknown", () => {
    const { activity } = setup();
    expect(activity.snapshot(42)).toEqual({
      phase: "unknown",
      source: null,
      severity: null,
      oscState: null,
    });
  });

  it("returns to unknown after a process reset until new signal arrives", () => {
    const { activity } = setup();
    activity.noteProcess(1, "claude");
    activity.noteOutputEvents(1, "\x1b]9;4;3\x07");
    expect(activity.snapshot(1).phase).toBe("working");
    activity.noteProcess(1, "zsh");
    expect(activity.snapshot(1)).toEqual({
      phase: "unknown",
      source: null,
      severity: null,
      oscState: null,
    });
  });
});
