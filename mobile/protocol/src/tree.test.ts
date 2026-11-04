import { describe, expect, it } from "vitest";
import { parseAgentChoices, parseTree } from "./tree";

const pane = (paneId: number, agent: string | null, extra: Record<string, unknown> = {}) => ({
  paneId,
  title: "t",
  agent,
  agentLabel: agent,
  phase: "idle",
  attention: "none",
  attentionSince: null,
  lastLine: "",
  lastOutputAt: null,
  ...extra,
});
const treeOf = (panes: unknown[]) => ({
  projects: [
    {
      name: "p",
      path: "/p",
      checkouts: [{ name: "main", path: "/p", branch: "main", panes }],
    },
  ],
});

describe("tree parsing", () => {
  it("keeps panes whose agent id is a label with spaces or a custom: id", () => {
    const tree = parseTree(
      treeOf([
        pane(1, "My Aider"),
        pane(2, "custom:my-aider"),
        pane(3, "Claude Code"),
        pane(4, null),
      ]),
    );
    expect(tree?.projects[0]?.checkouts[0]?.panes.map((p) => p.agent)).toEqual([
      "My Aider",
      "custom:my-aider",
      "Claude Code",
      null,
    ]);
  });

  it("drops one malformed pane, checkout or project and keeps the rest", () => {
    const tree = parseTree({
      projects: [
        ...treeOf([
          pane(1, "claude"),
          pane(2, "bad\u0007id"),
          pane(3, "x".repeat(65)),
          pane(4, null),
        ]).projects,
        { name: 5 },
      ],
    });
    expect(tree?.projects).toHaveLength(1);
    expect(tree?.projects[0]?.checkouts[0]?.panes.map((p) => p.paneId)).toEqual([1, 4]);
  });

  it("still refuses a value that is not a list or is too long", () => {
    expect(parseTree({ projects: "x" })).toBeNull();
    expect(parseTree({ projects: Array.from({ length: 201 }, () => ({})) })).toBeNull();
  });

  it("lists custom agents and drops an unusable one", () => {
    expect(
      parseAgentChoices([
        { id: "My Aider", label: "My Aider" },
        { id: "custom:x", label: "X" },
        { id: " ", label: "blank" },
        { id: "", label: "empty" },
      ]),
    ).toEqual([
      { id: "My Aider", label: "My Aider" },
      { id: "custom:x", label: "X" },
    ]);
  });
});
