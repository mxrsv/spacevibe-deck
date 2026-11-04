import { describe, expect, it } from "vitest";
import type { RepositoryScan } from "../repositories/repository-client";
import { pane, tab } from "../ui/rail-view-fixtures";
import {
  buildMobileTree,
  buildProjectChoices,
  lastNonEmptyLine,
  phoneAgentChoices,
} from "./mobile-tree";

function checkout(path: string, branch: string) {
  return {
    path,
    head: "0".repeat(40),
    branch,
    bare: false,
    detached: false,
    locked: null,
    prunable: null,
  };
}

const REPO: RepositoryScan = {
  kind: "repository",
  key: "/w/deck/.git",
  root: "/w/deck",
  worktrees: [checkout("/w/deck", "main"), checkout("/w/deck-side", "feature")],
};
const scans = new Map<string, RepositoryScan>([
  ["/w/deck", REPO],
  ["/w/deck-side", REPO],
]);

describe("mobile tree", () => {
  it("groups panes by the rail's project and checkout, with phase, attention and last line", () => {
    const tree = buildMobileTree({
      tabs: [
        tab(1, "/w/deck", [pane(11, { attention: "requested", phase: "idle", changedAt: 500 })]),
        tab(2, "/w/deck-side", [pane(12, { phase: "working" }), pane(13, { agent: null })], {
          name: "Review",
        }),
      ],
      activeIndex: 0,
      scans,
      screenText: (id) => (id === 11 ? "\u001b[1mDo you want to proceed?\u001b[0m\n\n   \n" : ""),
      lastOutputAt: (id) => (id === 11 ? 77 : null),
      agentLabel: (id) => (id === "claude" ? "Claude Code" : null),
    });
    expect(tree.projects).toHaveLength(1);
    const project = tree.projects[0]!;
    expect(project.checkouts.map((c) => [c.path, c.branch])).toEqual([
      ["/w/deck", "main"],
      ["/w/deck-side", "feature"],
    ]);
    expect(project.checkouts[0]!.panes[0]).toMatchObject({
      paneId: 11,
      title: "Claude Code",
      agent: "claude",
      agentLabel: "Claude Code",
      attention: "requested",
      attentionSince: 500,
      lastLine: "Do you want to proceed?",
      lastOutputAt: 77,
    });
    expect(project.checkouts[1]!.panes.map((p) => [p.paneId, p.title, p.agent])).toEqual([
      [12, "Review", "claude"],
      [13, "Review", null],
    ]);
  });

  it("cuts the last line for a list row and skips empty screens", () => {
    expect(lastNonEmptyLine("x".repeat(500)).length).toBe(200);
    expect(lastNonEmptyLine("\n \n")).toBe("");
    expect(lastNonEmptyLine("a\nb\n\n")).toBe("b");
  });

  it("offers every checkout of a repository as one project, and plain folders as themselves", () => {
    const choices = buildProjectChoices(
      [
        { path: "/w/deck", scan: REPO },
        { path: "/w/deck-side", scan: REPO },
        { path: "/w/notes", scan: { kind: "plain", reason: "x" } },
      ],
      (path) => path.split("/").pop() ?? path,
    );
    expect(choices).toEqual([
      {
        name: "deck",
        path: "/w/deck",
        checkouts: [
          { name: "main", path: "/w/deck", branch: "main" },
          { name: "feature", path: "/w/deck-side", branch: "feature" },
        ],
      },
      {
        name: "notes",
        path: "/w/notes",
        checkouts: [{ name: "notes", path: "/w/notes", branch: null }],
      },
    ]);
  });

  it("offers custom agents, including ones whose label has a space, and drops unusable ids", () => {
    const option = (id: string, label = id, missing = false) => ({ id, label, missing });
    expect(
      phoneAgentChoices([
        option("Claude Code"),
        option("My Aider"),
        option("custom:my-aider", "My Aider"),
        option("Gone", "Gone", true),
        option(""),
        option("x".repeat(65)),
        option(" padded "),
        option("bell\u0007"),
      ]).map((agent) => agent.id),
    ).toEqual(["Claude Code", "My Aider", "custom:my-aider"]);
  });
});
