// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { activeWorkspace } from "../../files/file-surface-store";
import { repositoryScans } from "../../repositories/repositories-store";
import type { RepositoryScan } from "../../repositories/repository-client";
import { statusInfo, tabViews, type TabView } from "../../terminal/tabs-store";
import { dockRoot, resolveDockRoot, type DockRootInput } from "./dock-root";

const HOME = "/home/kyan";

const input = (over: Partial<DockRootInput> = {}): DockRootInput => ({
  cwd: "/r/side/src",
  surfaceFocused: false,
  home: HOME,
  checkouts: ["/r/main", "/r/side"],
  fallback: "/r/main",
  ...over,
});

describe("resolveDockRoot", () => {
  it("is the checkout holding the cwd, not the tab's folder", () => {
    expect(resolveDockRoot(input())).toBe("/r/side");
    expect(resolveDockRoot(input({ cwd: "/r/main" }))).toBe("/r/main");
  });

  it("takes the longest checkout when one nests inside another", () => {
    const checkouts = ["/r/main", "/r/main/.worktrees/side"];
    expect(resolveDockRoot(input({ cwd: "/r/main/.worktrees/side/src", checkouts }))).toBe(
      "/r/main/.worktrees/side",
    );
    expect(resolveDockRoot(input({ cwd: "/r/main/src", checkouts }))).toBe("/r/main");
  });

  it("does not treat a shared name prefix as a parent", () => {
    expect(
      resolveDockRoot(input({ cwd: "/a/foobar/x", checkouts: ["/a/foo"], fallback: "/b" })),
    ).toBe("/b");
    expect(resolveDockRoot(input({ cwd: "/a/foo/x", checkouts: ["/a/foo"], fallback: "/b" }))).toBe(
      "/a/foo",
    );
  });

  it("answers the tab's folder before the first poll and while a file surface has the keyboard", () => {
    expect(resolveDockRoot(input({ cwd: null }))).toBe("/r/main");
    expect(resolveDockRoot(input({ surfaceFocused: true }))).toBe("/r/main");
  });

  it("answers the tab's folder for a cwd outside every checkout", () => {
    expect(resolveDockRoot(input({ cwd: "/tmp/scratch" }))).toBe("/r/main");
  });

  it("is never the home directory or a parent of it", () => {
    const checkouts = ["/r/main", HOME, "/home", "/"];
    expect(resolveDockRoot(input({ cwd: `${HOME}/projects/other`, checkouts }))).toBe("/r/main");
    expect(resolveDockRoot(input({ cwd: "/home/someone", checkouts }))).toBe("/r/main");
    // A checkout under home is a real answer.
    expect(
      resolveDockRoot(
        input({ cwd: `${HOME}/code/app/src`, checkouts: [...checkouts, `${HOME}/code/app`] }),
      ),
    ).toBe(`${HOME}/code/app`);
  });

  it("keeps a home folder the user opened as the fallback, and null when there is none", () => {
    expect(resolveDockRoot(input({ cwd: "/tmp/x", fallback: HOME }))).toBe(HOME);
    expect(resolveDockRoot(input({ cwd: "/tmp/x", fallback: null }))).toBeNull();
  });

  it("reads Windows paths", () => {
    expect(
      resolveDockRoot(
        input({
          cwd: "C:\\code\\side\\src",
          checkouts: ["C:\\code\\main", "C:\\code\\side"],
          home: "C:\\Users\\kyan",
          fallback: "C:\\code\\main",
        }),
      ),
    ).toBe("C:\\code\\side");
  });
});

describe("dockRoot", () => {
  const scan = (...paths: string[]): RepositoryScan => ({
    kind: "repository",
    key: "/r/.git",
    root: "/r/main",
    worktrees: paths.map((path) => ({
      path,
      head: "a",
      branch: "b",
      bare: false,
      detached: false,
      locked: null,
      prunable: null,
    })),
  });
  const tab = (workspacePath: string | null): TabView =>
    ({ key: 1, workspacePath, panes: [] }) as unknown as TabView;

  beforeEach(() => {
    activeWorkspace.value = "/r/main";
    tabViews.value = [tab("/r/main")];
    repositoryScans.value = new Map([["/r/main", scan("/r/main", "/r/side")]]);
    statusInfo.value = { branch: null, cwd: null, agent: null, paneCount: 1, home: HOME };
  });

  afterEach(() => {
    activeWorkspace.value = null;
    tabViews.value = [];
    repositoryScans.value = new Map();
  });

  it("follows the focused pane's cwd and writes nothing", () => {
    expect(dockRoot.value).toBe("/r/main");
    statusInfo.value = { ...statusInfo.value, cwd: "/r/side/src" };
    expect(dockRoot.value).toBe("/r/side");
    expect(activeWorkspace.value).toBe("/r/main");
    statusInfo.value = { ...statusInfo.value, cwd: null };
    expect(dockRoot.value).toBe("/r/main");
  });

  it("finds a checkout the scans do not list through an open tab's folder", () => {
    repositoryScans.value = new Map();
    tabViews.value = [tab("/r/main"), tab("/w/notes")];
    statusInfo.value = { ...statusInfo.value, cwd: "/w/notes/drafts" };
    expect(dockRoot.value).toBe("/w/notes");
  });

  it("does not wake its readers for a cwd that leaves the root where it was", () => {
    let runs = 0;
    const stop = dockRoot.subscribe(() => {
      runs += 1;
    });
    const subscribed = runs;
    statusInfo.value = { ...statusInfo.value, cwd: "/r/main/src" };
    statusInfo.value = { ...statusInfo.value, cwd: "/r/main/docs" };
    expect(runs).toBe(subscribed);
    stop();
  });
});
