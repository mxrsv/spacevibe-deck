import { describe, expect, it } from "vitest";
import {
  applyResumeOptions,
  composeLaunchCommand,
  defaultLaunchOptions,
  resolveLaunchOptions,
} from "./launch-command";
import type { LaunchProfile } from "./launch-profile";

const plan: LaunchProfile = {
  id: "lp:plan",
  name: "Plan",
  options: { kind: "claude", model: "opus", permissionMode: "plan" },
};

const sandboxed: LaunchProfile = {
  id: "lp:sandboxed",
  name: "Sandboxed",
  options: {
    kind: "codex",
    model: null,
    sandbox: "workspace-write",
    approval: "on-request",
  },
};

describe("composeLaunchCommand", () => {
  it("builds a claude command with both options", () => {
    expect(composeLaunchCommand(plan.options)).toBe(
      "claude --model opus --permission-mode plan",
    );
  });

  it("omits every option left null", () => {
    expect(
      composeLaunchCommand({
        kind: "claude",
        model: null,
        permissionMode: null,
      }),
    ).toBe("claude");
  });

  it("builds a codex command", () => {
    expect(composeLaunchCommand(sandboxed.options)).toBe(
      "codex --sandbox workspace-write --ask-for-approval on-request",
    );
  });

  it("builds an opencode command and only adds --auto when true", () => {
    expect(
      composeLaunchCommand({
        kind: "opencode",
        model: "anthropic/claude-sonnet-5",
        agent: "build",
        auto: true,
      }),
    ).toBe("opencode --model anthropic/claude-sonnet-5 --agent build --auto");
    expect(
      composeLaunchCommand({
        kind: "opencode",
        model: null,
        agent: null,
        auto: false,
      }),
    ).toBe("opencode");
  });
});

describe("resolveLaunchOptions", () => {
  it("returns the profile's options when the agent matches", () => {
    expect(resolveLaunchOptions("claude", "lp:plan", [plan])).toEqual(
      plan.options,
    );
  });

  it("refuses a profile belonging to another agent", () => {
    expect(resolveLaunchOptions("codex", "lp:plan", [plan])).toBeNull();
  });

  it("returns null for a null agent, a null id and an unknown id", () => {
    expect(resolveLaunchOptions(null, "lp:plan", [plan])).toBeNull();
    expect(resolveLaunchOptions("claude", null, [plan])).toBeNull();
    expect(resolveLaunchOptions("claude", "lp:gone", [plan])).toBeNull();
  });
});

describe("defaultLaunchOptions", () => {
  it("reads the agent's declared default", () => {
    expect(
      defaultLaunchOptions("claude", [plan], { claude: "lp:plan" }),
    ).toEqual(plan.options);
  });

  it("returns null when the agent has no default", () => {
    expect(defaultLaunchOptions("claude", [plan], {})).toBeNull();
    expect(
      defaultLaunchOptions(null, [plan], { claude: "lp:plan" }),
    ).toBeNull();
  });
});

describe("applyResumeOptions", () => {
  it("appends claude's options to its resume command", () => {
    expect(applyResumeOptions("claude --resume abc123", plan.options)).toBe(
      "claude --resume abc123 --model opus --permission-mode plan",
    );
  });

  it("leaves every other agent's resume command alone", () => {
    expect(applyResumeOptions("codex resume abc123", sandboxed.options)).toBe(
      "codex resume abc123",
    );
    expect(applyResumeOptions("claude --continue", null)).toBe(
      "claude --continue",
    );
  });

  it("leaves a command that is not this agent's own alone", () => {
    expect(applyResumeOptions("review --resume x", plan.options)).toBe(
      "review --resume x",
    );
  });
});
