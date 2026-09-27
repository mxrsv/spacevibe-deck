import { describe, expect, it } from "vitest";
import type { SessionTab, WindowRecord } from "../lib/session-schema";
import { summarizeLastSession } from "./last-session-store";

function tab(workspacePath: string | null): SessionTab {
  return {
    workspacePath,
    layout: { type: "leaf" },
    panes: [{ cwd: null, agent: null, launchCommand: null, taskPrompt: null }],
    name: null,
    dotColor: null,
  };
}

function record(tabs: readonly SessionTab[]): WindowRecord {
  return {
    savedAt: 1,
    activeTabIndex: 0,
    tabs,
    files: [],
    activeFileTab: null,
    agentBoardOpen: false,
    agentBoardSurfaceActive: false,
  };
}

describe("summarizeLastSession", () => {
  it("offers nothing when no window held a tab", () => {
    expect(summarizeLastSession(new Map([["main", record([])]]), "main")).toBeNull();
    expect(summarizeLastSession(new Map(), "main")).toBeNull();
  });

  it("counts every window's tabs and names each workspace once", () => {
    const records = new Map([
      ["main", record([tab("/repo/deck"), tab("/repo/deck/"), tab(null)])],
      ["second", record([tab("/repo/api")])],
    ]);
    const summary = summarizeLastSession(records, "main");
    expect(summary).toMatchObject({ mainLabel: "main", tabCount: 4, workspaces: ["deck", "api"] });
    expect(summary?.records).toBe(records);
  });
});
