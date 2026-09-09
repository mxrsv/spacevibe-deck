import { describe, expect, it } from "vitest";
import type { CustomAgent } from "../lib/agent-catalog";
import { restartCommandFor } from "./pane-restart";

const NO_CUSTOM: readonly CustomAgent[] = [];

describe("restartCommandFor", () => {
  it("resumes the exact session when one is known", () => {
    expect(
      restartCommandFor({
        agent: "claude",
        sessionId: "abc123",
        launchCommand: null,
        customAgents: NO_CUSTOM,
      }),
    ).toBe("claude --resume abc123");
  });

  it("asks for the LATEST session when no id is known — never a bare relaunch", () => {
    // `buildResumeCommand` answers a null ref with `forms.bare`, which is the
    // fresh relaunch §17 Q4 refused. `{ kind: "latest" }` is the honest ask.
    expect(
      restartCommandFor({
        agent: "claude",
        sessionId: null,
        launchCommand: null,
        customAgents: NO_CUSTOM,
      }),
    ).toBe("claude --continue");
  });

  it("folds the pane's own launch flags back in", () => {
    expect(
      restartCommandFor({
        agent: "claude",
        sessionId: "abc123",
        launchCommand: "claude --dangerously-skip-permissions",
        customAgents: NO_CUSTOM,
      }),
    ).toBe("claude --resume abc123 --dangerously-skip-permissions");
  });

  it("answers null for an agent with no resume form", () => {
    expect(
      restartCommandFor({
        agent: "not-an-agent",
        sessionId: null,
        launchCommand: null,
        customAgents: NO_CUSTOM,
      }),
    ).toBeNull();
  });

  it("takes a custom agent's own declared command", () => {
    // `buildResumeCommand` matches a custom agent by LABEL and ignores the
    // ref entirely — no custom CLI declares a resume form — so Restart on one
    // relaunches exactly what the user declared, and this is the one branch
    // where a null command means "the label is not a custom agent either".
    expect(
      restartCommandFor({
        agent: "my-wrapper",
        sessionId: "abc123",
        launchCommand: null,
        customAgents: [{ id: "custom-1", label: "my-wrapper", command: "my-wrapper --serve" }],
      }),
    ).toBe("my-wrapper --serve");
  });
});
