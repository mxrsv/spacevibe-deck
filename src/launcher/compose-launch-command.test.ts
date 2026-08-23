import { describe, expect, it } from "vitest";
import { composeLaunchCommand, stripFlag } from "./compose-launch-command";
import { runtimeFor } from "./runtime-catalog";

const CLAUDE = runtimeFor("claude");

describe("compose-launch-command", () => {
  it("appends model and effort to the agent's default command", () => {
    const result = composeLaunchCommand({
      agentId: "claude",
      capability: CLAUDE,
      baseCommand: "claude --dangerously-skip-permissions",
      modelId: "opus",
      reasoningEffort: "high",
      declaredModels: {},
    });
    expect(result).toEqual({
      ok: true,
      command: "claude --dangerously-skip-permissions --model opus --effort high",
    });
  });

  it("replaces a model flag the base command already carries", () => {
    const result = composeLaunchCommand({
      agentId: "claude",
      capability: CLAUDE,
      baseCommand: "claude --model sonnet --dangerously-skip-permissions",
      modelId: "opus",
      reasoningEffort: null,
      declaredModels: {},
    });
    expect(result).toEqual({
      ok: true,
      command: "claude --dangerously-skip-permissions --model opus",
    });
  });

  it("leaves the base untouched when nothing is selected", () => {
    const result = composeLaunchCommand({
      agentId: "claude",
      capability: CLAUDE,
      baseCommand: "claude --dangerously-skip-permissions",
      modelId: null,
      reasoningEffort: null,
      declaredModels: {},
    });
    expect(result).toEqual({ ok: true, command: "claude --dangerously-skip-permissions" });
  });

  it("drops an effort the agent has no flag for rather than inventing one", () => {
    const result = composeLaunchCommand({
      agentId: "codex",
      capability: runtimeFor("codex"),
      baseCommand: "codex",
      modelId: "gpt-5",
      reasoningEffort: "high",
      declaredModels: {},
    });
    expect(result).toEqual({ ok: true, command: "codex --model gpt-5" });
  });

  it("refuses an effort the agent's capability does not list", () => {
    const result = composeLaunchCommand({
      agentId: "agy",
      capability: runtimeFor("agy"),
      baseCommand: "agy --dangerously-skip-permissions",
      modelId: null,
      // agy's --help documents low|medium|high; "max" is a stale draft value
      // carried over from claude, and spec §8 step 3 says it must be refused.
      reasoningEffort: "max",
      declaredModels: {},
    });
    expect(result.ok).toBe(false);
  });

  it("refuses a model absent from a non-empty list", () => {
    const result = composeLaunchCommand({
      agentId: "claude",
      capability: CLAUDE,
      baseCommand: "claude",
      modelId: "a-model-nobody-declared",
      reasoningEffort: null,
      declaredModels: {},
    });
    expect(result.ok).toBe(false);
  });

  it("accepts a model the user declared in Settings", () => {
    const result = composeLaunchCommand({
      agentId: "claude",
      capability: CLAUDE,
      baseCommand: "claude",
      modelId: "my-alias",
      reasoningEffort: null,
      declaredModels: { claude: ["my-alias"] },
    });
    expect(result).toEqual({ ok: true, command: "claude --model my-alias" });
  });

  it("refuses a model value the shell guard would reject", () => {
    const result = composeLaunchCommand({
      agentId: "cursor-agent",
      capability: runtimeFor("cursor-agent"),
      baseCommand: "cursor-agent --force",
      modelId: "claude-opus-4-8[context=1m]",
      reasoningEffort: null,
      declaredModels: { "cursor-agent": ["claude-opus-4-8[context=1m]"] },
    });
    expect(result.ok).toBe(false);
  });

  it("refuses an agent with no base command at all", () => {
    const result = composeLaunchCommand({
      agentId: "custom:gone",
      capability: null,
      baseCommand: null,
      modelId: null,
      reasoningEffort: null,
      declaredModels: {},
    });
    expect(result.ok).toBe(false);
  });

  it("leaves a custom agent's command alone", () => {
    const result = composeLaunchCommand({
      agentId: "custom:wrapper",
      capability: null,
      baseCommand: "my-wrapper.sh --loud",
      modelId: "ignored",
      reasoningEffort: "ignored",
      declaredModels: {},
    });
    expect(result).toEqual({ ok: true, command: "my-wrapper.sh --loud" });
  });

  it("strips a flag and its value only when the flag matches whole", () => {
    expect(stripFlag("claude --model opus --effort high", "--model")).toBe("claude --effort high");
    expect(stripFlag("claude --model-picker on", "--model")).toBe("claude --model-picker on");
    expect(stripFlag("claude --effort high", null)).toBe("claude --effort high");
  });
});
