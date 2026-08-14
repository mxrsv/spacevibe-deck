import { describe, expect, it } from "vitest";
import type { TabView } from "../terminal/tabs-store";
import type { RepositoryScan } from "./repository-client";
import { buildRail, worktreeForPath } from "./repository-model";

const IDLE = { kind: "idle", actionableCount: 0, workingCount: 0, unreadCount: 0 } as const;

function tab(key: number, workspacePath: string | null, over: Partial<TabView> = {}): TabView {
  return {
    key,
    process: "zsh",
    name: null,
    dotColor: null,
    workspacePath,
    agents: [],
    agentBusy: false,
    unread: false,
    attention: IDLE,
    ...over,
  };
}

function repo(
  key: string,
  worktrees: readonly { path: string; branch?: string; prunable?: string }[],
): RepositoryScan {
  return {
    kind: "repository",
    key,
    root: worktrees[0].path,
    worktrees: worktrees.map((entry) => ({
      path: entry.path,
      head: "0".repeat(40),
      branch: entry.branch ?? null,
      bare: false,
      detached: false,
      locked: null,
      prunable: entry.prunable ?? null,
    })),
  };
}

describe("worktreeForPath", () => {
  it("takes the longest matching prefix, so a nested worktree wins", () => {
    const paths = ["/repo", "/repo/packages/web"];
    expect(worktreeForPath(paths, "/repo/packages/web/src")).toBe(
      "/repo/packages/web",
    );
    expect(worktreeForPath(paths, "/repo/docs")).toBe("/repo");
  });

  it("does not let /repo claim /repo-two", () => {
    // A bare startsWith would, and the two are unrelated checkouts.
    expect(worktreeForPath(["/repo"], "/repo-two")).toBeNull();
  });

  it("returns null when nothing contains the path", () => {
    expect(worktreeForPath(["/a"], "/b")).toBeNull();
  });
});

describe("buildRail", () => {
  it("groups two worktrees of one repository under one header", () => {
    const scan = repo("/r/.git", [
      { path: "/r/main", branch: "main" },
      { path: "/r/side", branch: "side" },
    ]);
    const groups = buildRail({
      tabs: [tab(1, "/r/main"), tab(2, "/r/side")],
      activeIndex: 0,
      scans: new Map([
        ["/r/main", scan],
        ["/r/side", scan],
      ]),
      collapsed: new Set(),
    });
    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe("repository");
    expect(groups[0].worktrees.map((w) => w.name)).toEqual(["main", "side"]);
    expect(groups[0].worktrees[0].primary).toBe(true);
    expect(groups[0].worktrees[1].primary).toBe(false);
  });

  it("names a worktree after its branch, not its directory", () => {
    // The main checkout's directory is named after the repository, so a
    // basename title would repeat the header and distinguish nothing.
    const scan = repo("/r/.git", [
      { path: "/r/spacevibe-deck", branch: "main" },
      { path: "/r/wt-1", branch: "redesign/phase-1-2" },
    ]);
    const groups = buildRail({
      tabs: [tab(1, "/r/spacevibe-deck")],
      activeIndex: 0,
      scans: new Map([["/r/spacevibe-deck", scan]]),
      collapsed: new Set(),
    });
    expect(groups[0].name).toBe("spacevibe-deck");
    expect(groups[0].worktrees.map((w) => w.name)).toEqual([
      "main",
      "redesign/phase-1-2",
    ]);
  });

  it("falls back to the directory when a worktree has no branch", () => {
    const scan = repo("/r/.git", [{ path: "/r/detached" }]);
    const groups = buildRail({
      tabs: [tab(1, "/r/detached")],
      activeIndex: 0,
      scans: new Map([["/r/detached", scan]]),
      collapsed: new Set(),
    });
    expect(groups[0].worktrees[0].name).toBe("detached");
  });

  it("lists a worktree nobody opened, as `idle` with no tabs", () => {
    const scan = repo("/r/.git", [
      { path: "/r/main", branch: "main" },
      { path: "/r/side", branch: "side" },
    ]);
    const groups = buildRail({
      tabs: [tab(1, "/r/main")],
      activeIndex: 0,
      scans: new Map([["/r/main", scan]]),
      collapsed: new Set(),
    });
    expect(groups[0].worktrees[1]).toMatchObject({ state: "idle", tabs: [] });
  });

  it("keeps a folder that is not a repository working, as its own group", () => {
    const groups = buildRail({
      tabs: [tab(1, "/home/me/scratch")],
      activeIndex: 0,
      scans: new Map([
        ["/home/me/scratch", { kind: "plain", reason: "not a git repository" }],
      ]),
      collapsed: new Set(),
    });
    expect(groups[0].kind).toBe("plain");
    expect(groups[0].name).toBe("scratch");
    expect(groups[0].worktrees[0].tabs).toHaveLength(1);
  });

  it("renders a tab before its scan lands, and regroups after", () => {
    const before = buildRail({
      tabs: [tab(1, "/r/main")],
      activeIndex: 0,
      scans: new Map(),
      collapsed: new Set(),
    });
    expect(before[0].kind).toBe("plain");
    expect(before[0].worktrees[0].tabs).toHaveLength(1);

    const after = buildRail({
      tabs: [tab(1, "/r/main")],
      activeIndex: 0,
      scans: new Map([["/r/main", repo("/r/.git", [{ path: "/r/main" }])]]),
      collapsed: new Set(),
    });
    expect(after[0].kind).toBe("repository");
  });

  it("ranks missing above attention above working above ready", () => {
    const busy = tab(1, "/r/main", { agentBusy: true });
    const shouting = tab(2, "/r/side", {
      attention: { ...IDLE, kind: "error", actionableCount: 2 },
    });
    const scan = repo("/r/.git", [
      { path: "/r/main" },
      { path: "/r/side" },
      { path: "/r/gone", prunable: "gitdir file points to non-existent location" },
    ]);
    const groups = buildRail({
      tabs: [busy, shouting],
      activeIndex: 0,
      scans: new Map([
        ["/r/main", scan],
        ["/r/side", scan],
      ]),
      collapsed: new Set(),
    });
    expect(groups[0].worktrees.map((w) => w.state)).toEqual([
      "working",
      "attention",
      "missing",
    ]);
  });

  it("keeps a missing worktree's open tab attached to its row", () => {
    // §5: a row with an open tab never vanishes, or the session loses the only
    // handle it was reached through.
    const scan = repo("/r/.git", [
      { path: "/r/main" },
      { path: "/r/gone", prunable: "gitdir file points to non-existent location" },
    ]);
    const groups = buildRail({
      tabs: [tab(1, "/r/gone")],
      activeIndex: 0,
      scans: new Map([["/r/gone", scan]]),
      collapsed: new Set(),
    });
    const gone = groups[0].worktrees.find((w) => w.path === "/r/gone");
    expect(gone).toMatchObject({ state: "missing" });
    expect(gone?.tabs).toHaveLength(1);
  });

  it("attaches a tab opened on a subdirectory to its worktree", () => {
    const scan = repo("/r/.git", [{ path: "/r/main" }]);
    const groups = buildRail({
      tabs: [tab(1, "/r/main/packages/web")],
      activeIndex: 0,
      scans: new Map([["/r/main/packages/web", scan]]),
      collapsed: new Set(),
    });
    expect(groups[0].worktrees[0].tabs).toHaveLength(1);
  });

  it("drops a bare entry — it has no working directory to run in", () => {
    const scan: RepositoryScan = {
      kind: "repository",
      key: "/r.git",
      root: "/r.git",
      worktrees: [
        {
          path: "/r.git",
          head: null,
          branch: null,
          bare: true,
          detached: false,
          locked: null,
          prunable: null,
        },
        {
          path: "/r/main",
          head: "a",
          branch: "main",
          bare: false,
          detached: false,
          locked: null,
          prunable: null,
        },
      ],
    };
    const groups = buildRail({
      tabs: [tab(1, "/r/main")],
      activeIndex: 0,
      scans: new Map([["/r/main", scan]]),
      collapsed: new Set(),
    });
    expect(groups[0].worktrees.map((w) => w.path)).toEqual(["/r/main"]);
    expect(groups[0].worktrees[0].primary).toBe(true);
  });

  it("marks the active tab, and only that one", () => {
    const scan = repo("/r/.git", [{ path: "/r/main" }, { path: "/r/side" }]);
    const groups = buildRail({
      tabs: [tab(1, "/r/main"), tab(2, "/r/side")],
      activeIndex: 1,
      scans: new Map([
        ["/r/main", scan],
        ["/r/side", scan],
      ]),
      collapsed: new Set(),
    });
    expect(groups[0].worktrees[0].tabs[0].active).toBe(false);
    expect(groups[0].worktrees[1].tabs[0].active).toBe(true);
  });

  it("aggregates and deduplicates agent identities across a worktree's tabs", () => {
    const scan = repo("/r/.git", [{ path: "/r/main" }]);
    const groups = buildRail({
      tabs: [
        tab(1, "/r/main", { agents: ["claude", "codex"] }),
        tab(2, "/r/main/packages/web", {
          agents: ["claude", "Custom Agent"],
        }),
      ],
      activeIndex: 0,
      scans: new Map([
        ["/r/main", scan],
        ["/r/main/packages/web", scan],
      ]),
      collapsed: new Set(),
    });

    expect(groups[0].worktrees[0]).toMatchObject({
      agents: ["claude", "codex", "Custom Agent"],
    });
  });

  it("gives a tab with no workspace path a home of its own", () => {
    const groups = buildRail({
      tabs: [tab(7, null)],
      activeIndex: 0,
      scans: new Map(),
      collapsed: new Set(),
    });
    expect(groups[0].key).toBe("plain:unknown-7");
    expect(groups[0].worktrees[0].tabs).toHaveLength(1);
  });

  it("keeps group order stable at the tab that introduced each repository", () => {
    const a = repo("/a/.git", [{ path: "/a" }]);
    const b = repo("/b/.git", [{ path: "/b" }]);
    const groups = buildRail({
      tabs: [tab(1, "/b"), tab(2, "/a")],
      activeIndex: 0,
      scans: new Map([
        ["/a", a],
        ["/b", b],
      ]),
      collapsed: new Set(),
    });
    expect(groups.map((group) => group.key)).toEqual(["/b/.git", "/a/.git"]);
  });

  it("passes collapse state through by repository key", () => {
    const scan = repo("/r/.git", [{ path: "/r/main" }]);
    const groups = buildRail({
      tabs: [tab(1, "/r/main")],
      activeIndex: 0,
      scans: new Map([["/r/main", scan]]),
      collapsed: new Set(["/r/.git"]),
    });
    expect(groups[0].collapsed).toBe(true);
  });
});
