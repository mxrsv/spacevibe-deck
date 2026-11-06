import { describe, expect, it } from "vitest";
import type { TreePane } from "@protocol/tree";
import { paneSignature, PINNED_MAX, selectNeedsYou, type DesktopTreeView } from "./needs-you";

const pane = (
  paneId: number,
  attention: TreePane["attention"],
  since: number | null,
): TreePane => ({
  paneId,
  title: `pane ${paneId}`,
  agent: "claude",
  agentLabel: "Claude Code",
  phase: "idle",
  attention,
  attentionSince: since,
  lastLine: "",
  lastOutputAt: null,
});

const desktop = (id: string, panes: TreePane[]): DesktopTreeView => ({
  id,
  name: id.toUpperCase(),
  tree: {
    projects: [
      {
        name: "deck",
        path: "/deck",
        checkouts: [{ name: "main", path: "/deck", branch: "main", panes }],
      },
    ],
  },
});

describe("selectNeedsYou", () => {
  it("takes requested and error panes only", () => {
    const result = selectNeedsYou([
      desktop("a", [
        pane(1, "requested", 5),
        pane(2, "completed", 9),
        pane(3, "warning", 9),
        pane(4, "none", 9),
        pane(5, "error", 4),
      ]),
    ]);
    expect(result.all.map((i) => i.pane.paneId)).toEqual([1, 5]);
  });

  it("orders newest first across desktops, with unknown times last", () => {
    const result = selectNeedsYou([
      desktop("a", [pane(1, "requested", 10), pane(2, "requested", null)]),
      desktop("b", [pane(3, "error", 30), pane(4, "requested", 20)]),
    ]);
    expect(result.all.map((i) => `${i.desktopId}${i.pane.paneId}`)).toEqual([
      "b3",
      "b4",
      "a1",
      "a2",
    ]);
  });

  it("pins three and counts the rest for See all", () => {
    const panes = [1, 2, 3, 4, 5].map((n) => pane(n, "requested", n));
    const result = selectNeedsYou([desktop("a", panes)]);
    expect(PINNED_MAX).toBe(3);
    expect(result.pinned.map((i) => i.pane.paneId)).toEqual([5, 4, 3]);
    expect(result.more).toBe(2);
    expect(selectNeedsYou([desktop("a", panes.slice(0, 3))]).more).toBe(0);
  });

  it("skips a desktop with no live tree", () => {
    expect(selectNeedsYou([{ id: "a", name: "A", tree: null }]).all).toEqual([]);
  });
});

describe("paneSignature", () => {
  it("changes when the screen may have changed", () => {
    const base = pane(1, "requested", 5);
    expect(paneSignature(base)).toBe(paneSignature({ ...base }));
    expect(paneSignature(base)).not.toBe(paneSignature({ ...base, lastLine: "x" }));
    expect(paneSignature(base)).not.toBe(paneSignature({ ...base, lastOutputAt: 9 }));
  });
});
