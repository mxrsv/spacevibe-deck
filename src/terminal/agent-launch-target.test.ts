import { describe, expect, it } from "vitest";
import { resolveAgentLaunchTarget, type LaunchTargetTab } from "./agent-launch-target";

const tab = (key: number, workspacePath: string): LaunchTargetTab => ({
  key,
  workspacePath,
  paneId: key * 10,
});

describe("resolveAgentLaunchTarget", () => {
  it("prefers the active matching tab without changing its identity", () => {
    expect(resolveAgentLaunchTarget("/repo", [tab(1, "/repo"), tab(2, "/repo/pkg")], 2)).toEqual({
      kind: "split",
      workspacePath: "/repo",
      tabKey: 2,
      paneId: 20,
    });
  });
  it("opens a new space when the focused pane is in another checkout (RAIL4)", () => {
    const tabs = [tab(1, "/repo/other"), tab(2, "/repo/pkg"), tab(3, "/repo")];
    // The active tab is the sibling worktree: the target checkout's own tabs
    // sit in the background, so nothing is split into them.
    expect(resolveAgentLaunchTarget("/repo", tabs, 1, ["/repo", "/repo/other"])).toEqual({
      kind: "new-space",
      workspacePath: "/repo",
    });
    expect(resolveAgentLaunchTarget("/repo", [tab(1, "/repo")], null)).toEqual({
      kind: "new-space",
      workspacePath: "/repo",
    });
  });
  it("splits a nested tab of the checkout when it holds the focused pane", () => {
    const tabs = [tab(1, "/repo/other"), tab(2, "/repo/pkg"), tab(3, "/repo")];
    expect(resolveAgentLaunchTarget("/repo", tabs, 2, ["/repo", "/repo/other"])).toMatchObject({
      kind: "split",
      tabKey: 2,
    });
  });
  it("excludes sibling worktrees from the checkout's tabs", () => {
    const tabs = [tab(1, "/repo/other")];
    expect(
      resolveAgentLaunchTarget("/repo", [tabs[0], tab(4, "/repo-old")], 1, [
        "/repo",
        "/repo/other",
      ]),
    ).toEqual({ kind: "first-pane", workspacePath: "/repo" });
  });
  it("handles root directories and rejects empty input", () => {
    expect(resolveAgentLaunchTarget("/", [tab(1, "/tmp")], 1)).toMatchObject({ tabKey: 1 });
    expect(resolveAgentLaunchTarget("  ", [], null)).toBeNull();
  });
  it("compares Windows paths without rewriting the requested launch path", () => {
    expect(
      resolveAgentLaunchTarget("C:\\Repo\\", [tab(1, "c:/repo/pkg")], 1, [], "windows"),
    ).toEqual({ kind: "split", workspacePath: "C:\\Repo\\", tabKey: 1, paneId: 10 });
    expect(
      resolveAgentLaunchTarget(
        "\\\\Server\\Share\\",
        [tab(1, "//server/share/pkg")],
        1,
        [],
        "windows",
      ),
    ).toMatchObject({ kind: "split" });
    expect(resolveAgentLaunchTarget("C:\\", [tab(1, "c:/repo")], 1, [], "windows")).toMatchObject({
      kind: "split",
    });
  });
  it("keeps POSIX case significant and ignores tabs without a live pane", () => {
    expect(
      resolveAgentLaunchTarget("/repo", [tab(1, "/Repo"), { ...tab(2, "/repo"), paneId: null }], 1),
    ).toEqual({ kind: "first-pane", workspacePath: "/repo" });
  });
});
