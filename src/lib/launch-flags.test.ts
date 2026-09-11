import { describe, expect, it } from "vitest";
import { BUILTIN_AGENTS } from "./agent-catalog";
import { LAUNCH_FLAGS, composeLaunchFlags, launchFlagsFor, parseLaunchFlags } from "./launch-flags";

const roundTrip = (agentId: string, command: string): string => {
  const parsed = parseLaunchFlags(agentId, command);
  return composeLaunchFlags(agentId, parsed.values, parsed.other);
};

describe("LAUNCH_FLAGS", () => {
  it("covers every built-in agent", () => {
    expect(Object.keys(LAUNCH_FLAGS).sort()).toEqual(BUILTIN_AGENTS.map((a) => a.id).sort());
  });

  it("gives a toggle exactly one option and every option a form", () => {
    for (const flags of Object.values(LAUNCH_FLAGS)) {
      for (const flag of flags) {
        if (flag.kind === "toggle") {
          expect(flag.options).toHaveLength(1);
        }
        for (const choice of flag.options) {
          expect(choice.forms.length).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe("parseLaunchFlags / composeLaunchFlags", () => {
  it("reads every shipped command into controls and writes it back unchanged", () => {
    for (const agent of BUILTIN_AGENTS) {
      const command = agent.defaultCommand ?? agent.id;
      expect(parseLaunchFlags(agent.id, command).other).toBe("");
      expect(roundTrip(agent.id, command)).toBe(command);
    }
  });

  it("reads a valued flag and its short form", () => {
    expect(parseLaunchFlags("claude", "claude --permission-mode plan").values.permissions).toBe(
      "plan",
    );
    expect(parseLaunchFlags("codex", "codex -s read-only").values.sandbox).toBe("read-only");
  });

  it("reads aliases and writes the canonical spelling", () => {
    expect(roundTrip("gemini", "gemini -y")).toBe("gemini --yolo");
    expect(roundTrip("gemini", "gemini --approval-mode yolo")).toBe("gemini --yolo");
    expect(roundTrip("cursor-agent", "cursor-agent -f --plan")).toBe(
      "cursor-agent --force --mode plan",
    );
  });

  it("reads --flag=value but only claims the whole token", () => {
    expect(roundTrip("codex", "codex --sandbox=workspace-write")).toBe(
      "codex --sandbox workspace-write",
    );
    // agy's `--sandbox` is a toggle; `--sandbox=true` is not that token.
    expect(parseLaunchFlags("agy", "agy --sandbox=true")).toEqual({
      values: { skip: null, mode: null, sandbox: null },
      other: "--sandbox=true",
    });
  });

  it("keeps an unknown flag, and an unknown menu value, in other", () => {
    expect(
      parseLaunchFlags("claude", "claude --debug-file=/tmp/x --permission-mode weird"),
    ).toEqual({
      values: { permissions: null, ide: null, verbose: null },
      other: "--debug-file=/tmp/x --permission-mode weird",
    });
  });

  it("sends a second flag for a filled control to other", () => {
    const parsed = parseLaunchFlags(
      "claude",
      "claude --dangerously-skip-permissions --permission-mode plan",
    );
    expect(parsed.values.permissions).toBe("skip");
    expect(parsed.other).toBe("--permission-mode plan");
  });

  it("writes controls in catalog order, then other", () => {
    expect(
      roundTrip("claude", "claude --add-dir /tmp --verbose --ide --permission-mode auto"),
    ).toBe("claude --permission-mode auto --ide --verbose --add-dir /tmp");
    expect(composeLaunchFlags("codex", { search: "on", bypass: null }, "  ")).toBe(
      "codex --search",
    );
  });

  it("treats an agent it does not know as all other", () => {
    expect(launchFlagsFor("aider")).toEqual([]);
    expect(parseLaunchFlags("aider", "aider --yes")).toEqual({ values: {}, other: "--yes" });
  });
});
