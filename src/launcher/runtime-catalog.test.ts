import { describe, expect, it } from "vitest";
import { BUILTIN_AGENTS } from "../lib/agent-catalog";
import {
  AGENT_RUNTIMES,
  mergeRuntimeDefaults,
  modelsFor,
  parseRuntimeKey,
  runtimeFor,
  runtimeKey,
  runtimeOptions,
} from "./runtime-catalog";

describe("runtime-catalog", () => {
  it("describes every built-in agent exactly once", () => {
    const ids = AGENT_RUNTIMES.map((entry) => entry.agentId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const agent of BUILTIN_AGENTS) {
      expect(ids).toContain(agent.id);
    }
  });

  it("gives claude both flags and agy both flags", () => {
    expect(runtimeFor("claude")?.modelFlag).toBe("--model");
    expect(runtimeFor("claude")?.effortFlag).toBe("--effort");
    expect(runtimeFor("agy")?.modelFlag).toBe("--model");
    expect(runtimeFor("agy")?.effortFlag).toBe("--effort");
  });

  it("gives codex, opencode, gemini and cursor-agent no effort flag", () => {
    for (const id of ["codex", "opencode", "gemini", "cursor-agent"]) {
      expect(runtimeFor(id)?.modelFlag).toBe("--model");
      expect(runtimeFor(id)?.effortFlag).toBeNull();
    }
  });

  it("answers null for an agent it does not know", () => {
    expect(runtimeFor("custom:my-wrapper")).toBeNull();
    expect(runtimeFor(null)).toBeNull();
  });

  it("merges declared models over the seed without duplicating", () => {
    const merged = modelsFor("claude", { claude: ["opus", "my-custom-alias"] });
    const values = merged.map((entry) => entry.value);
    expect(new Set(values).size).toBe(values.length);
    expect(values).toContain("my-custom-alias");
    expect(values).toContain("opus");
  });

  it("gives an unknown agent only what the user declared", () => {
    expect(modelsFor("custom:my-wrapper", { "custom:my-wrapper": ["fast"] })).toEqual([
      { value: "fast", label: "fast" },
    ]);
  });

  it("produces model x effort options for an agent with both", () => {
    const options = runtimeOptions(runtimeFor("claude"), { claude: ["opus"] });
    expect(options.some((option) => option.label === "opus · high")).toBe(true);
  });

  it("produces model-only options for an agent with no effort flag", () => {
    const options = runtimeOptions(runtimeFor("codex"), { codex: ["gpt-5"] });
    expect(options).toHaveLength(1);
    expect(options[0].model).toBe("gpt-5");
    expect(options[0].effort).toBeNull();
    expect(options[0].label).toBe("gpt-5");
  });

  it("produces effort-only options for an agent with efforts but no models", () => {
    const options = runtimeOptions(runtimeFor("agy"), {});
    expect(options).toHaveLength(3);
    expect(options.every((option) => option.model === null)).toBe(true);
    expect(options.map((option) => option.effort)).toEqual(["low", "medium", "high"]);
  });

  it("produces nothing for an agent with no models and no efforts", () => {
    expect(runtimeOptions(runtimeFor("codex"), {})).toEqual([]);
  });

  it("lets a stored default override the catalog seed", () => {
    const merged = mergeRuntimeDefaults(runtimeFor("claude"), {
      model: "sonnet",
      effort: "low",
    });
    expect(merged?.defaultModel).toBe("sonnet");
    expect(merged?.defaultEffort).toBe("low");
  });

  it("ignores a stored default the capability does not list", () => {
    const merged = mergeRuntimeDefaults(runtimeFor("agy"), {
      model: null,
      effort: "max",
    });
    expect(merged?.defaultEffort).not.toBe("max");
  });

  it("returns the capability unchanged when nothing is stored", () => {
    const capability = runtimeFor("claude");
    expect(mergeRuntimeDefaults(capability, undefined)).toBe(capability);
  });

  it("round-trips a runtime key", () => {
    expect(parseRuntimeKey(runtimeKey("opus", "high"))).toEqual({
      model: "opus",
      effort: "high",
    });
    expect(parseRuntimeKey(runtimeKey(null, null))).toEqual({ model: null, effort: null });
    expect(parseRuntimeKey(runtimeKey("gpt-5", null))).toEqual({
      model: "gpt-5",
      effort: null,
    });
  });
});
