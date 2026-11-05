import { describe, expect, it } from "vitest";
import type { AgentOption } from "../lib/agent-catalog";
import type { LaunchCommandChoices } from "../lib/launch-command";
import {
  barProjectHits,
  enterAction,
  filterAgents,
  matchParts,
  reduceMenuKey,
  resolveDefaultPick,
  togglePick,
  type CommandBarProject,
} from "./command-bar-model";

const agent = (id: string, label: string, missing = false): AgentOption => ({
  id,
  label,
  detail: id,
  missing,
});
const AGENTS = [
  agent("claude", "Claude Code"),
  agent("codex", "Codex"),
  agent("gemini", "Gemini", true),
  agent("amp", "Amp"),
  agent("opencode", "OpenCode"),
  agent("goose", "Goose"),
];
const COMMANDS: Record<string, LaunchCommandChoices> = {
  claude: { default: "claude", commands: ["claude", "claude --resume"] },
  codex: { default: "codex", commands: ["codex"] },
};
const project = (name: string, age: string | null = null): CommandBarProject => ({
  path: `/p/${name}`,
  name,
  branch: "main",
  age,
});
const PROJECTS = ["deck", "bench-api", "benchmark", "academy"].map((name) => project(name));

describe("togglePick", () => {
  it("a plain press picks only that agent", () => {
    expect(togglePick(["claude", "codex"], "amp", false)).toEqual(["amp"]);
  });

  it("shift adds an agent, and removes it again", () => {
    expect(togglePick(["claude"], "codex", true)).toEqual(["claude", "codex"]);
    expect(togglePick(["claude", "codex"], "claude", true)).toEqual(["codex"]);
  });

  it("never empties the pick and never passes four agents", () => {
    expect(togglePick(["claude"], "claude", true)).toEqual(["claude"]);
    const four = ["claude", "codex", "amp", "opencode"];
    expect(togglePick(four, "goose", true)).toEqual(four);
  });
});

describe("resolveDefaultPick", () => {
  it("keeps the wanted agents that can run, else the first that can", () => {
    expect(resolveDefaultPick(["codex"], AGENTS)).toEqual(["codex"]);
    expect(resolveDefaultPick(["gemini"], AGENTS)).toEqual(["claude"]);
    expect(resolveDefaultPick([], AGENTS)).toEqual(["claude"]);
    expect(resolveDefaultPick([], [agent("gemini", "Gemini", true)])).toEqual([]);
  });
});

describe("filter", () => {
  it("narrows agents by name, id or default command", () => {
    expect(filterAgents(AGENTS, COMMANDS, "cod").map((a) => a.id)).toEqual([
      "claude",
      "codex",
      "opencode",
    ]);
    expect(filterAgents(AGENTS, COMMANDS, "  ").length).toBe(AGENTS.length);
  });

  it("lists at most five matching projects and never the targeted one", () => {
    const many = Array.from({ length: 9 }, (_, n) => project(`app-${n}`));
    expect(barProjectHits(many, "app", "/p/app-0").map((p) => p.name)).toEqual([
      "app-1",
      "app-2",
      "app-3",
      "app-4",
      "app-5",
    ]);
    expect(barProjectHits(many, "", null)).toEqual([]);
  });
});

describe("enterAction", () => {
  const hits = barProjectHits(PROJECTS, "bench", "/p/deck");
  it("runs the pick when nothing is typed", () => {
    expect(enterAction("", AGENTS, COMMANDS, [])).toEqual({ kind: "run" });
  });

  it("runs the first matching agent that can run, before any project", () => {
    expect(enterAction("codex", AGENTS, COMMANDS, hits)).toEqual({
      kind: "run-agent",
      agentId: "codex",
    });
  });

  it("switches to the first matching project when no agent matches", () => {
    expect(enterAction("bench", AGENTS, COMMANDS, hits)).toEqual({
      kind: "pick-project",
      path: "/p/bench-api",
    });
  });

  it("skips a missing agent and falls back to the pick when nothing matches", () => {
    expect(enterAction("gemini", AGENTS, COMMANDS, [])).toEqual({ kind: "run" });
  });
});

describe("matchParts and initials", () => {
  it("cuts a name around the first match, ignoring case", () => {
    expect(matchParts("Bench-API", "ch-a")).toEqual({ before: "Ben", match: "ch-A", after: "PI" });
    expect(matchParts("deck", "zz")).toEqual({ before: "deck", match: "", after: "" });
  });
});

describe("reduceMenuKey", () => {
  it("moves the highlight and wraps at both ends", () => {
    expect(reduceMenuKey(0, "ArrowDown", 3).index).toBe(1);
    expect(reduceMenuKey(2, "ArrowDown", 3).index).toBe(0);
    expect(reduceMenuKey(0, "ArrowUp", 3).index).toBe(2);
  });

  it("picks on Enter only when there is a row, and closes on Escape", () => {
    expect(reduceMenuKey(1, "Enter", 3)).toEqual({ index: 1, action: "pick" });
    expect(reduceMenuKey(0, "Enter", 0).action).toBe("none");
    expect(reduceMenuKey(1, "Escape", 3).action).toBe("close");
    expect(reduceMenuKey(1, "a", 3)).toEqual({ index: 1, action: "none" });
  });
});
