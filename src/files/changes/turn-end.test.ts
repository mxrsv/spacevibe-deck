import { describe, expect, it } from "vitest";
import type { PaneView, TabView } from "../../terminal/tabs-store";
import type { AgentPhase } from "../../terminal/agent-activity";
import { detectTurnEnds } from "./turn-end";

const pane = (paneId: number, phase: AgentPhase): PaneView =>
  ({ paneId, phase, agent: null, attention: "none" }) as unknown as PaneView;

const tab = (workspacePath: string | null, panes: PaneView[]): TabView =>
  ({ key: 1, workspacePath, panes }) as unknown as TabView;

describe("detectTurnEnds", () => {
  it("reports the workspace of a pane that left working for idle or exited", () => {
    const first = detectTurnEnds(new Map(), [
      tab("/a", [pane(1, "working")]),
      tab("/b", [pane(2, "working")]),
    ]);
    expect(first.ended).toEqual([]);
    const second = detectTurnEnds(first.next, [
      tab("/a", [pane(1, "idle")]),
      tab("/b", [pane(2, "exited")]),
    ]);
    expect([...second.ended].sort()).toEqual(["/a", "/b"]);
  });

  it("ignores a pane that was not working, one still working, and one going unknown", () => {
    const first = detectTurnEnds(new Map(), [
      tab("/a", [pane(1, "idle"), pane(2, "working"), pane(3, "working")]),
    ]);
    const second = detectTurnEnds(first.next, [
      tab("/a", [pane(1, "idle"), pane(2, "working"), pane(3, "unknown")]),
    ]);
    expect(second.ended).toEqual([]);
  });

  it("does not report twice for one stop, and skips a tab without a workspace", () => {
    const first = detectTurnEnds(new Map(), [tab(null, [pane(1, "working")])]);
    const second = detectTurnEnds(first.next, [tab(null, [pane(1, "idle")])]);
    expect(second.ended).toEqual([]);
    const third = detectTurnEnds(first.next, [tab("/a", [pane(1, "idle")])]);
    expect(third.ended).toEqual(["/a"]);
    expect(detectTurnEnds(third.next, [tab("/a", [pane(1, "idle")])]).ended).toEqual([]);
  });
});
