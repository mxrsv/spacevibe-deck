import { describe, expect, it } from "vitest";
import {
  folderName,
  forgetAgent,
  formatRelativeTime,
  MAX_RECENTS,
  partitionRecents,
  pushRecent,
  removeRecents,
  reorderRecents,
  resolveAgentChoice,
  validateWorkspaces,
  WORKSPACES_VERSION,
} from "./workspace-recents";
import type { RecentWorkspace } from "./workspace-recents";

const NOW = 1_800_000_000_000;

describe("resolveAgentChoice", () => {
  // Ids, not binary names: a built-in's id IS its binary name, and a declared
  // agent's is `custom:<slug>` (see lib/agent-catalog.ts).
  const agents = [{ id: "claude" }, { id: "codex" }];

  it("defaults to the first detected agent when nothing was picked", () => {
    expect(resolveAgentChoice(undefined, agents)).toBe("claude");
  });

  it("keeps a picked agent that is still detected", () => {
    expect(resolveAgentChoice("codex", agents)).toBe("codex");
  });

  it("falls back to the first agent when the memory is stale", () => {
    expect(resolveAgentChoice("gemini", agents)).toBe("claude");
  });

  it("returns Shell only on an explicit null pick", () => {
    expect(resolveAgentChoice(null, agents)).toBeNull();
  });

  it("degrades to Shell only when no agent is detected", () => {
    expect(resolveAgentChoice(undefined, [])).toBeNull();
    expect(resolveAgentChoice("claude", [])).toBeNull();
  });
});

describe("pushRecent", () => {
  it("puts a folder it has never seen first", () => {
    const one = pushRecent([], "/a", NOW);
    const two = pushRecent(one, "/b", NOW + 1);
    expect(two.map((r) => r.path)).toEqual(["/b", "/a"]);
  });

  it("dedupes by path, keeping its place with a fresh timestamp", () => {
    const list = pushRecent(pushRecent([], "/a", NOW), "/b", NOW + 1);
    const again = pushRecent(list, "/a", NOW + 2);
    // Hand-placed order outranks recency: re-opening /a must not lift it.
    expect(again.map((r) => r.path)).toEqual(["/b", "/a"]);
    expect(again[1].lastOpenedAt).toBe(NOW + 2);
  });

  it("caps the list at MAX_RECENTS, dropping the last row", () => {
    let list = pushRecent([], "/0", NOW);
    for (let i = 1; i <= MAX_RECENTS; i += 1) {
      list = pushRecent(list, `/${i}`, NOW + i);
    }
    expect(list).toHaveLength(MAX_RECENTS);
    expect(list.some((r) => r.path === "/0")).toBe(false);
  });

  it("evicts the bottom row even when it is the most recently opened", () => {
    // The price of manual order: the row the user parked last is the one the
    // cap drops, however fresh its timestamp is.
    let list = pushRecent([], "/keep", NOW);
    for (let i = 1; i < MAX_RECENTS; i += 1) {
      list = pushRecent(list, `/${i}`, NOW + i);
    }
    list = pushRecent(list, "/keep", NOW + 1000); // newest, still at the bottom
    expect(list[list.length - 1].path).toBe("/keep");

    const full = pushRecent(list, "/fresh", NOW + 2000);
    expect(full.some((r) => r.path === "/keep")).toBe(false);
    expect(full[0].path).toBe("/fresh");
  });

  it("records the layout + agent combo on the entry", () => {
    const [entry] = pushRecent([], "/a", NOW, "preset-1", "claude");
    expect(entry.lastPresetId).toBe("preset-1");
    expect(entry.lastAgent).toBe("claude");
  });

  it("inherits the previous combo when re-pushed with undefined", () => {
    const first = pushRecent([], "/a", NOW, "preset-1", "codex");
    const again = pushRecent(first, "/a", NOW + 5);
    expect(again[0].lastOpenedAt).toBe(NOW + 5);
    expect(again[0].lastPresetId).toBe("preset-1");
    expect(again[0].lastAgent).toBe("codex");
  });

  it("treats agent null as an explicit Shell-only overwrite", () => {
    const first = pushRecent([], "/a", NOW, "preset-1", "claude");
    const again = pushRecent(first, "/a", NOW + 5, "preset-1", null);
    expect(again[0].lastAgent).toBeNull();
  });
});

describe("reorderRecents", () => {
  const list: readonly RecentWorkspace[] = ["/a", "/b", "/c", "/d"].map(
    (path, index) => ({ path, lastOpenedAt: NOW - index }),
  );
  const paths = (entries: readonly RecentWorkspace[]): string[] =>
    entries.map((entry) => entry.path);

  it("drops a row into the gap before the target", () => {
    expect(paths(reorderRecents(list, "/d", "/b", false))).toEqual([
      "/a",
      "/d",
      "/b",
      "/c",
    ]);
  });

  it("drops a row into the gap after the target", () => {
    expect(paths(reorderRecents(list, "/a", "/c", true))).toEqual([
      "/b",
      "/c",
      "/a",
      "/d",
    ]);
  });

  it("carries the moved entry whole, not just its path", () => {
    const withCombo: readonly RecentWorkspace[] = [
      { path: "/a", lastOpenedAt: NOW, lastPresetId: "p-grid" },
      { path: "/b", lastOpenedAt: NOW - 1 },
    ];
    const moved = reorderRecents(withCombo, "/a", "/b", true);
    expect(moved[1].lastPresetId).toBe("p-grid");
    expect(moved[1].lastOpenedAt).toBe(NOW);
  });

  // The three no-ops below share one contract: same array back, so the store
  // can skip the disk write on an identity check alone.
  it("returns the same array when the row lands where it already is", () => {
    expect(reorderRecents(list, "/b", "/a", true)).toBe(list);
    expect(reorderRecents(list, "/b", "/c", false)).toBe(list);
  });

  it("returns the same array when a row is dropped onto itself", () => {
    expect(reorderRecents(list, "/b", "/b", false)).toBe(list);
  });

  it("returns the same array when either path is unknown", () => {
    expect(reorderRecents(list, "/ghost", "/b", false)).toBe(list);
    expect(reorderRecents(list, "/a", "/ghost", false)).toBe(list);
  });

  it("moves a row across a gap that a missing folder sits in", () => {
    // Missing rows render in their own group but stay interleaved in the
    // file, so a move addressed by path must step over them untouched.
    const mixed: readonly RecentWorkspace[] = [
      { path: "/a", lastOpenedAt: NOW },
      { path: "/ghost", lastOpenedAt: NOW - 1 },
      { path: "/b", lastOpenedAt: NOW - 2 },
    ];
    expect(paths(reorderRecents(mixed, "/b", "/a", false))).toEqual([
      "/b",
      "/a",
      "/ghost",
    ]);
  });
});

describe("removeRecents", () => {
  const list = pushRecent(
    pushRecent(pushRecent([], "/a", NOW), "/b", NOW + 1),
    "/c",
    NOW + 2,
  );

  it("removes a single path from the middle of the list", () => {
    expect(removeRecents(list, ["/b"]).map((r) => r.path)).toEqual([
      "/c",
      "/a",
    ]);
  });

  it("removes several paths at once", () => {
    expect(removeRecents(list, ["/a", "/c"]).map((r) => r.path)).toEqual([
      "/b",
    ]);
  });

  it("leaves the list unchanged for a path that is not there", () => {
    expect(removeRecents(list, ["/nope"])).toEqual(list);
  });
});

describe("partitionRecents", () => {
  const list = pushRecent(
    pushRecent(pushRecent([], "/a", NOW), "/b", NOW + 1),
    "/c",
    NOW + 2,
  );

  it("splits live and missing rows, keeping each side's order", () => {
    const { alive, missing } = partitionRecents(list, new Set(["/c", "/a"]));
    expect(alive.map((r) => r.path)).toEqual(["/b"]);
    expect(missing.map((r) => r.path)).toEqual(["/c", "/a"]);
  });

  it("puts everything in alive when nothing is missing", () => {
    const { alive, missing } = partitionRecents(list, new Set());
    expect(alive).toEqual(list);
    expect(missing).toEqual([]);
  });
});

describe("validateWorkspaces", () => {
  it("returns empty data for corrupt input", () => {
    expect(validateWorkspaces(undefined)).toEqual({
      version: WORKSPACES_VERSION,
      recents: [],
    });
    expect(validateWorkspaces({ version: 9 })).toEqual({
      version: WORKSPACES_VERSION,
      recents: [],
    });
  });

  it("keeps valid entries and drops junk", () => {
    const raw = {
      version: 2,
      recents: [
        { path: "/a", lastOpenedAt: NOW },
        { path: "", lastOpenedAt: NOW },
        { path: "/b", lastOpenedAt: "yesterday" },
        42,
      ],
    };
    expect(validateWorkspaces(raw).recents).toEqual([
      { path: "/a", lastOpenedAt: NOW },
    ]);
  });

  it("reads a v1 file, keeping entries that lack the combo fields", () => {
    const raw = { version: 1, recents: [{ path: "/a", lastOpenedAt: NOW }] };
    const data = validateWorkspaces(raw);
    expect(data.version).toBe(WORKSPACES_VERSION);
    expect(data.recents).toEqual([{ path: "/a", lastOpenedAt: NOW }]);
    expect(data.recents[0].lastPresetId).toBeUndefined();
    expect(data.recents[0].lastAgent).toBeUndefined();
  });

  it("keeps well-formed combo fields and drops malformed ones", () => {
    const raw = {
      version: 2,
      recents: [
        { path: "/a", lastOpenedAt: NOW, lastPresetId: "p1", lastAgent: null },
        { path: "/b", lastOpenedAt: NOW, lastPresetId: 7, lastAgent: "" },
      ],
    };
    const [a, b] = validateWorkspaces(raw).recents;
    expect(a).toEqual({
      path: "/a",
      lastOpenedAt: NOW,
      lastPresetId: "p1",
      lastAgent: null,
    });
    expect(b).toEqual({ path: "/b", lastOpenedAt: NOW });
  });
});

describe("display helpers", () => {
  it("folderName returns the last segment", () => {
    expect(folderName("/Users/dev/work/monorepo")).toBe("monorepo");
    expect(folderName("/")).toBe("/");
  });

  it("formatRelativeTime buckets by age", () => {
    const MIN = 60_000;
    const DAY = 24 * 60 * MIN;
    expect(formatRelativeTime(NOW - 30_000, NOW)).toBe("just now");
    expect(formatRelativeTime(NOW - MIN, NOW)).toBe("1 minute ago");
    expect(formatRelativeTime(NOW - 5 * MIN, NOW)).toBe("5 minutes ago");
    expect(formatRelativeTime(NOW - 2 * 60 * MIN, NOW)).toBe("2 hours ago");
    expect(formatRelativeTime(NOW - DAY - 60 * MIN, NOW)).toBe("Yesterday");
    expect(formatRelativeTime(NOW - 3 * DAY, NOW)).toBe("3 days ago");
    expect(formatRelativeTime(NOW - 7 * DAY, NOW)).toBe("1 week ago");
    expect(formatRelativeTime(NOW - 14 * DAY, NOW)).toBe("2 weeks ago");
    expect(formatRelativeTime(NOW - 45 * DAY, NOW)).toBe("1 month ago");
    expect(formatRelativeTime(NOW - 200 * DAY, NOW)).toBe("6 months ago");
    expect(formatRelativeTime(NOW - 365 * DAY, NOW)).toBe("1 year ago");
    expect(formatRelativeTime(NOW - 800 * DAY, NOW)).toBe("2 years ago");
  });
});

describe("resolveAgentChoice — declared agents", () => {
  const agents = [{ id: "claude" }, { id: "custom:aider" }];

  it("keeps a declared agent id", () => {
    expect(resolveAgentChoice("custom:aider", agents)).toBe("custom:aider");
  });

  it("falls back when the declared agent was deleted", () => {
    expect(resolveAgentChoice("custom:gone", agents)).toBe("claude");
  });
});

describe("forgetAgent", () => {
  const withAgent = (path: string, agent: string) =>
    pushRecent([], path, NOW, "preset-1", agent);

  it("drops the memory of one agent, keeping the folder", () => {
    const [entry] = forgetAgent(
      withAgent("/a", "custom:aider"),
      "custom:aider",
    );
    expect(entry.path).toBe("/a");
    expect(entry.lastPresetId).toBe("preset-1");
    expect("lastAgent" in entry).toBe(false);
  });

  it("leaves folders that remembered a different agent untouched", () => {
    const list = pushRecent(
      withAgent("/a", "custom:aider"),
      "/b",
      NOW + 1,
      "preset-1",
      "claude",
    );
    const after = forgetAgent(list, "custom:aider");
    expect(after.find((entry) => entry.path === "/b")?.lastAgent).toBe(
      "claude",
    );
  });

  it("returns the same entry objects when nothing remembered it", () => {
    const list = withAgent("/a", "claude");
    const after = forgetAgent(list, "custom:gone");
    // Identity matters: the store skips its disk write when nothing changed.
    expect(after[0]).toBe(list[0]);
  });

  it("never resurrects a deleted agent's id for an old folder", () => {
    // The bug this closes: ids come from the label, so re-adding "Aider"
    // regenerates custom:aider and the folder would launch the new command.
    const list = withAgent("/a", "custom:aider");
    const after = forgetAgent(list, "custom:aider");
    expect(
      resolveAgentChoice(after[0].lastAgent, [{ id: "custom:aider" }]),
    ).toBe("custom:aider");
    expect(after[0].lastAgent).toBeUndefined();
  });
});
