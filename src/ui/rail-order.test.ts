import { describe, expect, it } from "vitest";
import type { RepositoryScan } from "../repositories/repository-client";
import type { RailStreamGroup } from "./agent-rail-model";
import { applyRailOrder, MAX_RAIL_ORDER, pinAt, sameRailOrder } from "./rail-order";

/**
 * A cluster reduced to the two fields this module reads. Everything else on
 * `RailStreamGroup` belongs to the renderer, and the ordering rules are stated
 * against `orderKey` alone (spec §3).
 */
function live(orderKey: string, project = orderKey): RailStreamGroup {
  return {
    key: orderKey,
    orderKey,
    project,
    labelled: true,
    rows: [],
    path: null,
    historyPaths: [],
    tabIndexes: [],
  };
}

/** The same project after its last tab closed: `key` moves, `orderKey` does not. */
function remembered(orderKey: string, path: string): RailStreamGroup {
  return {
    key: `remembered:${orderKey}`,
    orderKey,
    project: orderKey,
    labelled: true,
    rows: [],
    path,
    historyPaths: [path],
    tabIndexes: [],
  };
}

const NO_SCANS: ReadonlyMap<string, RepositoryScan> = new Map();

function scansFor(path: string, key: string): ReadonlyMap<string, RepositoryScan> {
  return new Map<string, RepositoryScan>([
    [path, { kind: "repository", key, root: path, worktrees: [] }],
  ]);
}

describe("applyRailOrder", () => {
  it("returns the stream itself when no project has been dragged", () => {
    const stream = [live("a"), live("b")];
    // Identity, not a copy: with no manual order the rail must be exactly the
    // list the model assembled (spec §4, rule 2).
    expect(applyRailOrder(stream, [], NO_SCANS)).toBe(stream);
  });

  it("emits pinned clusters first, in the stored order", () => {
    const stream = [live("a"), live("b"), live("c")];
    const result = applyRailOrder(stream, ["c", "a"], NO_SCANS);
    expect(result.map((group) => group.orderKey)).toEqual(["c", "a", "b"]);
  });

  it("keeps unpinned clusters in exactly today's order", () => {
    const stream = [live("a"), live("b"), live("c"), live("d")];
    const result = applyRailOrder(stream, ["c"], NO_SCANS);
    expect(result.map((group) => group.orderKey)).toEqual(["c", "a", "b", "d"]);
  });

  it("skips entries naming no present cluster instead of dropping them", () => {
    const stream = [live("a"), live("b")];
    const railOrder = ["parked", "b"];
    expect(applyRailOrder(stream, railOrder, NO_SCANS).map((g) => g.orderKey)).toEqual(["b", "a"]);
    // The list itself is untouched — the memory of a parked project is what
    // brings it back to its slot when it is reopened.
    expect(railOrder).toEqual(["parked", "b"]);
  });

  it("keeps a pinned project in its slot when its last tab closes", () => {
    // The owner's case, asserted directly. `key` changes with the tier;
    // `orderKey` does not, so the position survives.
    const railOrder = ["/repos/deck/.git"];
    const whileLive = [live("/repos/api/.git"), live("/repos/deck/.git")];
    expect(applyRailOrder(whileLive, railOrder, NO_SCANS).map((g) => g.orderKey)).toEqual([
      "/repos/deck/.git",
      "/repos/api/.git",
    ]);

    const afterClose = [live("/repos/api/.git"), remembered("/repos/deck/.git", "/repos/deck")];
    const result = applyRailOrder(afterClose, railOrder, NO_SCANS);
    expect(result.map((g) => g.orderKey)).toEqual(["/repos/deck/.git", "/repos/api/.git"]);
    // And it is the REMEMBERED cluster that took the top slot, above live work.
    expect(result[0].key).toBe("remembered:/repos/deck/.git");
  });

  it("matches a plain entry once the scan resolves that path to a repository", () => {
    // Written before the scan landed; the cluster now reports the repo key.
    const stream = [live("/repos/api/.git"), live("/repos/deck/.git")];
    const scans = scansFor("/repos/deck", "/repos/deck/.git");
    const result = applyRailOrder(stream, ["plain:/repos/deck"], scans);
    expect(result.map((g) => g.orderKey)).toEqual(["/repos/deck/.git", "/repos/api/.git"]);
  });

  it("keeps both clusters when two of them share one orderKey", () => {
    // `coveredHistoryPaths` names this case: a history entry whose scan
    // resolves to a live cluster's repository key, with no live worktree path
    // as its prefix, builds a remembered cluster under that same key. Pinning
    // may only LIFT one of them — dropping the other would take a project off
    // the rail that the user never touched.
    const stream = [
      live("/repos/api/.git"),
      live("/repos/deck/.git"),
      remembered("/repos/deck/.git", "/repos/deck-side"),
    ];
    const result = applyRailOrder(stream, ["/repos/deck/.git"], NO_SCANS);
    expect(result).toHaveLength(3);
    expect(result.map((g) => g.key)).toEqual([
      "/repos/deck/.git",
      "/repos/api/.git",
      "remembered:/repos/deck/.git",
    ]);
  });

  it("does not resolve a plain entry the scan map still knows nothing about", () => {
    const stream = [live("plain:/home/me/scratch"), live("a")];
    const result = applyRailOrder(stream, ["plain:/home/me/scratch"], NO_SCANS);
    expect(result.map((g) => g.orderKey)).toEqual(["plain:/home/me/scratch", "a"]);
  });
});

describe("pinAt", () => {
  it("pins the dropped cluster and everything above it", () => {
    const stream = [live("a"), live("b"), live("c"), live("d")];
    // `c` is dragged to slot 1.
    const next = pinAt({ stream, from: 2, to: 1, railOrder: [], scans: NO_SCANS });
    expect(next).toEqual(["a", "c"]);
    // The projects below stay unpinned, so they keep today's order.
    expect(applyRailOrder(stream, next, NO_SCANS).map((g) => g.orderKey)).toEqual([
      "a",
      "c",
      "b",
      "d",
    ]);
  });

  it("writes nothing new when a cluster is dropped where it started", () => {
    const stream = [live("a"), live("b")];
    const railOrder = ["b"];
    expect(pinAt({ stream, from: 1, to: 1, railOrder, scans: NO_SCANS })).toEqual(["b"]);
  });

  it("keeps entries naming absent projects after the new prefix", () => {
    const stream = [live("a"), live("b")];
    const next = pinAt({ stream, from: 1, to: 0, railOrder: ["parked"], scans: NO_SCANS });
    expect(next).toEqual(["b", "parked"]);
  });

  it("canonicalizes a plain entry the scan now resolves, without duplicating it", () => {
    const stream = [live("/repos/deck/.git"), live("a")];
    const scans = scansFor("/repos/deck", "/repos/deck/.git");
    // The stored list still spells the project the pre-scan way; the write
    // rewrites it and collapses the two spellings into one entry (spec §3.1).
    const next = pinAt({
      stream,
      from: 1,
      to: 0,
      railOrder: ["plain:/repos/deck"],
      scans,
    });
    expect(next).toEqual(["a", "/repos/deck/.git"]);
  });

  it("prunes absent entries from the end once the list would pass the cap", () => {
    const parked = Array.from({ length: MAX_RAIL_ORDER }, (_, index) => `parked-${index}`);
    const stream = [live("a"), live("b")];
    const next = pinAt({ stream, from: 1, to: 0, railOrder: parked, scans: NO_SCANS });
    expect(next.length).toBe(MAX_RAIL_ORDER);
    expect(next[0]).toBe("b");
    // The oldest memory is the one that goes, and the newly pinned project is
    // never the entry dropped to make room.
    expect(next).not.toContain(`parked-${MAX_RAIL_ORDER - 1}`);
    expect(next).toContain("parked-0");
  });

  it("never prunes a project that is on screen", () => {
    const stream = Array.from({ length: MAX_RAIL_ORDER + 2 }, (_, index) => live(`p${index}`));
    const railOrder = stream.map((group) => group.orderKey);
    const next = pinAt({ stream, from: 0, to: 1, railOrder, scans: NO_SCANS });
    expect(next.length).toBe(MAX_RAIL_ORDER + 2);
  });

  it("writes nothing rather than moving the wrong twin of a shared orderKey", () => {
    const stream = [
      live("a"),
      live("/repos/deck/.git"),
      remembered("/repos/deck/.git", "/repos/deck-side"),
    ];
    // A twinned key cannot express a position: `applyRailOrder` resolves it to
    // the FIRST cluster, and the controller resolves what was grabbed the same
    // way — so a drag on either twin would move the live one and leave the
    // dragged cluster where it was.
    expect(pinAt({ stream, from: 2, to: 0, railOrder: [], scans: NO_SCANS })).toEqual([]);
    expect(pinAt({ stream, from: 1, to: 0, railOrder: [], scans: NO_SCANS })).toEqual([]);
  });

  it("writes nothing when the pinned prefix would span a twinned key", () => {
    const stream = [
      live("/repos/deck/.git"),
      remembered("/repos/deck/.git", "/repos/deck-side"),
      live("a"),
    ];
    // Dropping `a` at the END spans both twins. `canonicalOrder` would collapse
    // the repeated key and write a two-entry prefix for three slots, landing
    // `a` ABOVE the insertion line it was dropped on.
    expect(pinAt({ stream, from: 2, to: 2, railOrder: [], scans: NO_SCANS })).toEqual([]);
    // Above both twins the prefix is just `a`, which IS expressible.
    expect(pinAt({ stream, from: 2, to: 0, railOrder: [], scans: NO_SCANS })).toEqual(["a"]);
    // And BETWEEN them the prefix spans only the first twin, so it is
    // expressible too — the refusal is scoped to a prefix that would have to
    // name one key twice, not to any stream that happens to contain a twin.
    const between = pinAt({ stream, from: 2, to: 1, railOrder: [], scans: NO_SCANS });
    expect(between).toEqual(["/repos/deck/.git", "a"]);
    expect(applyRailOrder(stream, between, NO_SCANS).map((g) => g.key)).toEqual([
      "/repos/deck/.git",
      "a",
      "remembered:/repos/deck/.git",
    ]);
  });

  it("ignores a coordinate no cluster owns", () => {
    const stream = [live("a")];
    expect(pinAt({ stream, from: 0, to: 4, railOrder: ["a"], scans: NO_SCANS })).toEqual(["a"]);
  });
});

describe("sameRailOrder", () => {
  it("is true only for the same entries in the same order", () => {
    expect(sameRailOrder(["a", "b"], ["a", "b"])).toBe(true);
    expect(sameRailOrder(["a", "b"], ["b", "a"])).toBe(false);
    expect(sameRailOrder(["a"], ["a", "b"])).toBe(false);
  });
});
