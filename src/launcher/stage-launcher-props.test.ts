import { describe, expect, it } from "vitest";
import type { AgentOption } from "../lib/agent-catalog";
import type { RecentWorkspace } from "../lib/workspace-recents";
import type { RepositoryScan } from "../repositories/repository-client";
import {
  launcherBeside,
  launcherDefaultPick,
  launcherProjects,
  launcherRequests,
  openFolderKeys,
  stageBarMode,
} from "./stage-launcher-props";

const NOW = 1_000_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

const recent = (path: string, ageMs: number, lastAgent?: string | null): RecentWorkspace => ({
  path,
  lastOpenedAt: NOW - ageMs,
  ...(lastAgent === undefined ? {} : { lastAgent }),
});

const agent = (id: string, missing = false): AgentOption => ({
  id,
  label: id,
  detail: id,
  missing,
});

describe("launcherProjects", () => {
  it("lists history in recency order with a short age only past a day", () => {
    const { projects } = launcherProjects({
      recents: [
        recent("/dev/api", 60_000),
        recent("/dev/deck", 3 * DAY),
        recent("/dev/old", 21 * DAY),
      ],
      livePaths: [],
      targetPath: "/dev/api",
      scans: new Map(),
      now: NOW,
    });
    expect(projects.map((project) => [project.name, project.age])).toEqual([
      ["api", null],
      ["deck", "3d"],
      ["old", "3w"],
    ]);
  });

  it("carries the branch of the checkout a scan knows", () => {
    const scan: RepositoryScan = {
      kind: "repository",
      key: "/dev/deck/.git",
      root: "/dev/deck",
      worktrees: [
        {
          path: "/dev/deck",
          head: "abc",
          branch: "main",
          bare: false,
          detached: false,
          locked: null,
          prunable: null,
        },
      ],
    };
    const { projects } = launcherProjects({
      recents: [recent("/dev/deck/", DAY / 2), recent("/dev/api", DAY / 2)],
      livePaths: [],
      targetPath: null,
      scans: new Map([["/dev/deck/", scan]]),
      now: NOW,
    });
    expect(projects.map((project) => project.branch)).toEqual(["main", null]);
  });

  it("adds a live workspace history lacks, after history, once", () => {
    const { projects } = launcherProjects({
      recents: [recent("/dev/api", 1)],
      livePaths: ["/dev/live", "/dev/api/"],
      targetPath: null,
      scans: new Map(),
      now: NOW,
    });
    expect(projects.map((project) => project.path)).toEqual(["/dev/api", "/dev/live"]);
  });

  it("names the target's own spelling as the current path, adding it when nothing else knows it", () => {
    const known = launcherProjects({
      recents: [recent("/dev/api", 1)],
      livePaths: [],
      targetPath: "/dev/api/",
      scans: new Map(),
      now: NOW,
    });
    expect(known.currentPath).toBe("/dev/api");
    const unknown = launcherProjects({
      recents: [recent("/dev/api", 1)],
      livePaths: [],
      targetPath: "/dev/wt-feature",
      scans: new Map(),
      now: NOW,
    });
    expect(unknown.projects.map((project) => project.path)).toEqual([
      "/dev/api",
      "/dev/wt-feature",
    ]);
    expect(unknown.currentPath).toBe("/dev/wt-feature");
  });

  it("is empty, with no current project, on a first run", () => {
    expect(
      launcherProjects({
        recents: [],
        livePaths: [],
        targetPath: null,
        scans: new Map(),
        now: NOW,
      }),
    ).toEqual({ projects: [], currentPath: null });
  });
});

describe("launcherDefaultPick", () => {
  const agents = [agent("claude"), agent("codex"), agent("gemini", true)];

  it("is the agent the project last ran", () => {
    expect(launcherDefaultPick([recent("/dev/api", 1, "codex")], "/dev/api/", agents)).toEqual([
      "codex",
    ]);
  });

  it("picks nothing for a shell, an agent that cannot run, an unknown one, or a new project", () => {
    expect(launcherDefaultPick([recent("/dev/api", 1, null)], "/dev/api", agents)).toEqual([]);
    expect(launcherDefaultPick([recent("/dev/api", 1, "gemini")], "/dev/api", agents)).toEqual([]);
    expect(launcherDefaultPick([recent("/dev/api", 1, "gone")], "/dev/api", agents)).toEqual([]);
    expect(launcherDefaultPick([recent("/dev/api", 1, "codex")], "/dev/other", agents)).toEqual([]);
    expect(launcherDefaultPick([], null, agents)).toEqual([]);
  });
});

describe("launcherBeside", () => {
  const tabs = [
    {
      key: 4,
      panes: [
        { paneId: 9, agent: "claude" },
        { paneId: 10, agent: null },
      ],
    },
  ];
  const label = (id: string) => id.toUpperCase();

  it("names the focused pane's agent for a split in the active space", () => {
    const split = { kind: "split", workspacePath: "/w", tabKey: 4, paneId: 9 } as const;
    expect(launcherBeside(split, tabs, label)).toBe("CLAUDE");
  });

  it("calls a plain shell pane a terminal", () => {
    const split = { kind: "split", workspacePath: "/w", tabKey: 4, paneId: 10 } as const;
    expect(launcherBeside(split, tabs, label)).toBe("Terminal");
  });

  it("is null for a new space, a first pane and no target", () => {
    expect(launcherBeside({ kind: "new-space", workspacePath: "/w" }, tabs, label)).toBeNull();
    expect(launcherBeside({ kind: "first-pane", workspacePath: "/w" }, tabs, label)).toBeNull();
    expect(launcherBeside(null, tabs, label)).toBeNull();
  });
});

describe("launcherRequests", () => {
  it("makes one request per agent in order, with an override only where one was picked", () => {
    const override = { kind: "profile", command: "codex --yolo" } as const;
    expect(launcherRequests(["claude", "codex"], { codex: override })).toEqual([
      { agentId: "claude" },
      { agentId: "codex", override },
    ]);
  });
});

describe("stageBarMode", () => {
  const base = {
    stageLauncher: true,
    liveTabCount: 0,
    otherSurfaces: 0,
    boardOpen: false,
    requestOpen: false,
  };

  it("is resident on an empty stage and absent behind the board or a live space", () => {
    expect(stageBarMode(base)).toBe("resident");
    expect(stageBarMode({ ...base, boardOpen: true })).toBe("none");
    expect(stageBarMode({ ...base, liveTabCount: 1 })).toBe("none");
    expect(stageBarMode({ ...base, otherSurfaces: 1 })).toBe("none");
  });

  it("floats when a request is open over a live space or a document", () => {
    expect(stageBarMode({ ...base, liveTabCount: 2, requestOpen: true })).toBe("floating");
    expect(stageBarMode({ ...base, otherSurfaces: 1, requestOpen: true })).toBe("floating");
  });

  it("stays resident while a request opens on an empty stage, so the bar does not remount", () => {
    expect(stageBarMode({ ...base, requestOpen: true })).toBe("resident");
  });

  it("stays resident when a first pane appears under a request that began on the empty stage", () => {
    expect(
      stageBarMode({ ...base, liveTabCount: 1, requestOpen: true, requestResident: true }),
    ).toBe("resident");
  });

  it("is never there with the switch off", () => {
    expect(stageBarMode({ ...base, stageLauncher: false })).toBe("none");
    expect(
      stageBarMode({ ...base, stageLauncher: false, requestOpen: true, liveTabCount: 1 }),
    ).toBe("none");
  });
});

describe("openFolderKeys", () => {
  // The registry holds no `open-folder` action yet, so the fixtures stand in for its binding.
  const bound = (binding: object) => [{ ...binding, action: "open-folder" }] as never;

  it("writes the bound chord's key caps for the platform", () => {
    expect(openFolderKeys("macos", bound({ key: "o", meta: true }))).toEqual(["⌘", "O"]);
    expect(openFolderKeys("windows", bound({ key: "o", ctrl: true }))).toEqual(["Ctrl", "O"]);
  });

  it("shows nothing while no chord is bound, rather than a chord that does nothing", () => {
    expect(openFolderKeys("macos", [])).toEqual([]);
    expect(openFolderKeys("macos")).toEqual([]);
  });
});
