import { describe, expect, it } from "vitest";
import type { CustomAgent } from "../../lib/agent-catalog";
import { freshLaunchRequest } from "./remembered-press";

/** The shipped command of `claude` (`lib/agents/claude.ts`), which its choices always list. */
const CLAUDE_DEFAULT = "claude --dangerously-skip-permissions";

const settings = (customAgents: readonly CustomAgent[] = []) => ({
  customAgents,
  launchProfiles: [],
  defaultLaunchProfiles: {},
});

describe("freshLaunchRequest", () => {
  it("passes the recorded command as a profile when the agent's choices list it", () => {
    expect(freshLaunchRequest({ agent: "claude" }, CLAUDE_DEFAULT, settings())).toEqual({
      agentId: "claude",
      override: { kind: "profile", command: CLAUDE_DEFAULT },
    });
  });

  it("falls back to the default command for one the agent does not list", () => {
    expect(freshLaunchRequest({ agent: "claude" }, "claude --evil", settings())).toEqual({
      agentId: "claude",
    });
    expect(freshLaunchRequest({ agent: "claude" }, null, settings())).toEqual({
      agentId: "claude",
    });
  });

  it("launches a declared agent by its id, though the pane records its label", () => {
    const custom: CustomAgent = { id: "custom:my-bot", label: "My Bot", command: "my-bot --fast" };

    expect(freshLaunchRequest({ agent: "My Bot" }, "my-bot --fast", settings([custom]))).toEqual({
      agentId: "custom:my-bot",
      override: { kind: "profile", command: "my-bot --fast" },
    });
  });
});
