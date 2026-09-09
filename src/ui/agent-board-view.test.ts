import { describe, expect, it } from "vitest";
import type { PaneView, TabView } from "../terminal/tabs-store";
import { boardInputFrom, type BoardViewSources } from "./agent-board-view";

const NOW = 1_760_000_000_000;

function pane(over: Partial<PaneView> = {}): PaneView {
  return {
    paneId: 11,
    agent: "claude",
    attention: "none",
    phase: "idle",
    hasRun: true,
    confidence: "explicit",
    changedAt: NOW - 60_000,
    ordinal: 3,
    startedAt: NOW - 600_000,
    lastAgent: "claude",
    ...over,
  } as PaneView;
}
function tab(panes: readonly PaneView[]): TabView {
  return {
    key: 1,
    title: "claude",
    process: "claude",
    active: true,
    workspacePath: "/Users/deck/deck",
    panes,
  } as unknown as TabView;
}
function base(): BoardViewSources {
  return {
    tabs: [],
    activeIndex: 0,
    scans: new Map(),
    workspaceHistoryPaths: [],
    tails: new Map(),
    tasks: new Map(),
    ordinals: new Map(),
    railOrder: [],
    selectedPaneId: null,
    statusFilter: "all",
    projectFilter: null,
    heldOrder: null,
    now: NOW,
  };
}

describe("boardInputFrom", () => {
  it("prefers the pane's own ordinal over the store's map", () => {
    const withField = boardInputFrom({
      ...base(),
      tabs: [tab([pane({ ordinal: 5 })])],
      ordinals: new Map([[11, 9]]),
    });
    expect(withField.ordinals.get(11)).toBe(5);
    const withoutField = boardInputFrom({
      ...base(),
      tabs: [tab([pane({ ordinal: undefined })])],
      ordinals: new Map([[11, 9]]),
    });
    expect(withoutField.ordinals.get(11)).toBe(9);
  });

  it("carries startedAt and lastAgent through as maps", () => {
    const input = boardInputFrom({ ...base(), tabs: [tab([pane()])] });
    expect(input.startedAt?.get(11)).toBe(NOW - 600_000);
    expect(input.lastAgents?.get(11)).toBe("claude");
  });

  it("carries the tracker's own trust bit, and claims nothing without one", () => {
    const explicit = boardInputFrom({
      ...base(),
      tabs: [tab([pane({ phaseConfidence: "explicit" })])],
    });
    expect(explicit.confidence?.get(11)).toBe("explicit");
    const inferred = boardInputFrom({
      ...base(),
      tabs: [tab([pane({ phaseConfidence: "inferred", confidence: "explicit" })])],
    });
    expect(inferred.confidence?.get(11)).toBe("inferred");
    // `undefined` is a REAL case, not just a fixture one: `tracker.snapshot(id)`
    // answers null until a poll has classified the pane, so an unclassified
    // pane has no tier. It must stay OUT of the map — the model reads
    // `input.confidence?.get(id) ?? null` (`agent-board-model.ts:303`), so
    // absence becomes `null`, which is "claims nothing".
    const silent = boardInputFrom({
      ...base(),
      tabs: [tab([pane({ phaseConfidence: "unknown" })])],
    });
    expect(silent.confidence?.has(11)).toBe(false);
  });

  it("passes the selection, both filters and the held order straight through", () => {
    const input = boardInputFrom({
      ...base(),
      tabs: [tab([pane()])],
      selectedPaneId: 11,
      statusFilter: "asked",
      projectFilter: "deck",
      heldOrder: [11, 12],
    });
    expect(input.selectedPaneId).toBe(11);
    expect(input.statusFilter).toBe("asked");
    expect(input.projectFilter).toBe("deck");
    expect(input.heldOrder).toEqual([11, 12]);
  });

  it("passes the home directory through, and omits it when there is none", () => {
    // `home` is what turns a plain folder's absolute path into `~/…`
    // (`tildePath`, `agent-board-model.ts:131-137`). The app has the fact —
    // `getDesktopEnvironment().homeDir` — so a card must not print the long
    // form the eye-approved specimen never showed.
    const known = boardInputFrom({ ...base(), home: "/Users/deck" });
    expect(known.home).toBe("/Users/deck");
    expect(boardInputFrom(base()).home).toBeUndefined();
  });
});
