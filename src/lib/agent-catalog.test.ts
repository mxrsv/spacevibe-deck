import { describe, expect, it } from "vitest";
import {
  agentBinary,
  BUILTIN_AGENTS,
  createCustomAgentId,
  isProbeSafeName,
  PROBE_NAME_MAX,
  probeNames,
  resolveAgentCommand,
  type CustomAgent,
} from "./agent-catalog";

const aider: CustomAgent = {
  id: "custom:aider",
  label: "Aider",
  command: "aider --model sonnet",
};

describe("agentBinary", () => {
  it("takes the first token of a command line", () => {
    expect(agentBinary("aider --model sonnet")).toBe("aider");
  });

  it("ignores surrounding and repeated whitespace", () => {
    expect(agentBinary("   aider   --model sonnet  ")).toBe("aider");
    expect(agentBinary("aider\t--model")).toBe("aider");
  });

  it("returns an empty string for a blank command", () => {
    expect(agentBinary("   ")).toBe("");
  });
});

describe("isProbeSafeName", () => {
  it("accepts bare names, paths and the punctuation real binaries use", () => {
    for (const name of [
      "aider",
      "opencode",
      "my-agent_1",
      "~/bin/agent.sh",
      "/opt/homebrew/bin/claude",
      "g++",
    ]) {
      expect(isProbeSafeName(name)).toBe(true);
    }
  });

  // The name is interpolated into `sh -ilc "command -v <name>"` (macos.rs), so
  // every character that gives a shell power has to be absent — this list is
  // the actual attack surface, not a sample.
  it("rejects anything a shell would act on", () => {
    for (const name of [
      "x; rm -rf ~",
      "x && rm -rf ~",
      "x | tee /tmp/x",
      "$(id)",
      "`id`",
      "x>out",
      "x<in",
      "a b",
      "a\nb",
      "a\tb",
      "'x'",
      '"x"',
      "x(1)",
      "x{1}",
      "x[1]",
      "x*",
      "x?",
      "x!",
      "x#c",
      "x\\y",
      "x%y",
      "x=y",
      "x:y",
      "x,y",
      "x@y",
      "x^y",
    ]) {
      expect(isProbeSafeName(name)).toBe(false);
    }
  });

  it("rejects an empty name and anything past the length cap", () => {
    expect(isProbeSafeName("")).toBe(false);
    expect(isProbeSafeName("a".repeat(PROBE_NAME_MAX))).toBe(true);
    expect(isProbeSafeName("a".repeat(PROBE_NAME_MAX + 1))).toBe(false);
  });
});

describe("createCustomAgentId", () => {
  it("slugs the label behind the custom prefix", () => {
    expect(createCustomAgentId("Aider", [])).toBe("custom:aider");
    expect(createCustomAgentId("My Script", [])).toBe("custom:my-script");
  });

  it("suffixes until the id is free", () => {
    const taken = [aider, { ...aider, id: "custom:aider-2" }];
    expect(createCustomAgentId("Aider", taken)).toBe("custom:aider-3");
  });

  it("falls back when the label slugs to nothing", () => {
    // A label of pure non-ASCII is legal to display and useless as a slug.
    expect(createCustomAgentId("エージェント", [])).toBe("custom:agent");
    expect(createCustomAgentId("...", [])).toBe("custom:agent");
  });

  it("never collides with a built-in id", () => {
    expect(createCustomAgentId("claude", [])).toBe("custom:claude");
  });
});

describe("resolveAgentCommand", () => {
  it("maps a built-in id to itself", () => {
    // The id/binary/command being one string is what keeps every lastAgent
    // already on disk working without a migration.
    for (const builtin of BUILTIN_AGENTS) {
      expect(resolveAgentCommand(builtin.id, [])).toBe(builtin.id);
    }
  });

  it("maps a custom id to its full command line", () => {
    expect(resolveAgentCommand("custom:aider", [aider])).toBe(
      "aider --model sonnet",
    );
  });

  it("returns null for an id nothing declares", () => {
    expect(resolveAgentCommand("custom:gone", [aider])).toBeNull();
    expect(resolveAgentCommand("nonsense", [aider])).toBeNull();
  });
});

describe("probeNames", () => {
  it("always includes every built-in", () => {
    expect(probeNames([])).toEqual(BUILTIN_AGENTS.map((agent) => agent.id));
  });

  it("adds each custom agent's binary once", () => {
    const twice: readonly CustomAgent[] = [
      aider,
      { id: "custom:aider-2", label: "Aider fast", command: "aider --fast" },
    ];
    expect(probeNames(twice).filter((name) => name === "aider")).toHaveLength(
      1,
    );
  });

  it("drops a custom binary the probe must not carry into a shell", () => {
    const evil: CustomAgent = {
      id: "custom:evil",
      label: "Evil",
      command: "x;rm -rf ~",
    };
    expect(probeNames([evil])).not.toContain("x;rm");
    expect(probeNames([evil])).toEqual(BUILTIN_AGENTS.map((a) => a.id));
  });

  it("does not re-list a custom binary that is already a built-in", () => {
    const resumed: CustomAgent = {
      id: "custom:claude-resume",
      label: "Claude resume",
      command: "claude --resume",
    };
    expect(probeNames([resumed])).toEqual(BUILTIN_AGENTS.map((a) => a.id));
  });
});
