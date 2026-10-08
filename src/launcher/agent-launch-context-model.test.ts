import { describe, expect, it } from "vitest";
import { buildLaunchContext } from "./agent-launch-context-model";
import type { RailStreamGroup } from "../ui/agent-rail-model";
import type { RepositoryScan } from "../repositories/repository-client";

const wt = (path: string, primary: boolean, active = false) =>
  ({ path, primary, active }) as unknown as RailStreamGroup["worktrees"][number];
const group = (
  project: string,
  worktrees: RailStreamGroup["worktrees"],
  path: string | null = null,
) => ({ project, worktrees, path }) as unknown as RailStreamGroup;
const entry = (path: string, branch: string | null, bare = false) => ({
  path,
  head: null,
  branch,
  bare,
  detached: false,
  locked: null,
  prunable: null,
});
const scans = new Map<string, RepositoryScan>([
  [
    "/w/deck",
    {
      kind: "repository",
      key: "/w/deck/.git",
      root: "/w/deck",
      worktrees: [
        entry("/w/deck", "main"),
        entry("/w/deck-wt", "feat"),
        entry("/w/bare", null, true),
      ],
    },
  ],
  ["/w/plain", { kind: "plain", reason: "none" }],
]);
const stream = [
  group("deck", [wt("/w/deck", true), wt("/w/deck-wt", false, true)]),
  group("plain", [wt("/w/plain", true)]),
  group("old", [], "/w/old"),
];

describe("buildLaunchContext", () => {
  it("lists one row per project, on the checkout holding the focused pane", () => {
    const view = buildLaunchContext({
      stream,
      scans,
      target: { kind: "new-space", workspacePath: "/w/deck" },
      agentLabel: null,
    });
    expect(view.workspaces.map((row) => [row.label, row.path])).toEqual([
      ["deck", "/w/deck-wt"],
      ["plain", "/w/plain"],
      ["old", "/w/old"],
    ]);
    expect(view.workspacePath).toBe("/w/deck-wt");
    expect(view.chip).toBe("New space");
  });

  it("lists non-bare checkouts by branch and marks linked ones", () => {
    const view = buildLaunchContext({
      stream,
      scans,
      target: { kind: "split", workspacePath: "/w/deck-wt", tabKey: 1, paneId: 2 },
      agentLabel: "Claude Code",
    });
    expect(view.checkouts).toEqual([
      { path: "/w/deck", label: "main", linked: false },
      { path: "/w/deck-wt", label: "feat", linked: true },
    ]);
    expect(view.checkoutPath).toBe("/w/deck-wt");
    expect(view.chip).toBe("Split beside Claude Code");
  });

  it("gives a plain or unlisted folder no checkouts and names the folder itself", () => {
    const plain = buildLaunchContext({
      stream,
      scans,
      target: { kind: "first-pane", workspacePath: "/w/plain" },
      agentLabel: null,
    });
    expect(plain.checkouts).toEqual([]);
    const picked = buildLaunchContext({
      stream,
      scans,
      target: { kind: "first-pane", workspacePath: "/elsewhere" },
      agentLabel: null,
    });
    expect(picked.workspacePath).toBe("/elsewhere");
    expect(picked.chip).toBe("New space");
  });
});
