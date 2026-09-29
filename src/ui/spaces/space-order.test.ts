import { describe, expect, it } from "vitest";
import type { TabView } from "../../terminal/tabs-store";
import { spaceOrderFromRail } from "./space-order";

function tab(key: number, workspacePath: string, openedAt: number): TabView {
  return {
    key,
    openedAt,
    process: null,
    name: null,
    dotColor: null,
    workspacePath,
    agents: [],
    agentBusy: false,
    unread: false,
  };
}

const input = (tabs: readonly TabView[]) => ({
  tabs,
  activeIndex: 0,
  scans: new Map(),
  workspaceHistoryPaths: [],
});

describe("spaceOrderFromRail", () => {
  it("keeps one workspace's spaces together, as the rail lists them", () => {
    // Opened /a, then /b, then /a again: open order would split /a in two.
    const tabs = [tab(1, "/a", 1), tab(2, "/b", 2), tab(3, "/a", 3)];

    expect(spaceOrderFromRail(input(tabs))).toEqual([0, 2, 1]);
  });

  it("does not move existing spaces when another one opens", () => {
    const before = [tab(1, "/a", 1), tab(2, "/b", 2)];
    const after = [...before, tab(3, "/c", 3)];

    expect(spaceOrderFromRail(input(before))).toEqual([0, 1]);
    expect(spaceOrderFromRail(input(after)).slice(0, 2)).toEqual([0, 1]);
  });

  it("lists every tab exactly once", () => {
    const tabs = [tab(1, "/a", 1), tab(2, "/b", 2), tab(3, "/a", 3), tab(4, "/c", 4)];
    const order = spaceOrderFromRail(input(tabs));

    expect([...order].sort()).toEqual([0, 1, 2, 3]);
  });
});
