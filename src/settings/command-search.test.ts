import { describe, expect, expectTypeOf, it } from "vitest";
import { BUILTIN_AGENTS } from "../lib/agent-catalog";
import {
  chordsForAction,
  defaultKeymap,
  NO_KEYBINDING_OVERRIDES,
  withOverride,
} from "../lib/keybindings";
import type { CategoryId } from "../ui/settings/active-category-store";
import {
  activeKeyIn,
  moveActive,
  type CommandArea,
  type CommandAreaId,
  type CommandHit,
  type CommandItem,
  type ReportedIssue,
} from "./command-hits";
import {
  attentionIssues,
  buildCommandItems,
  changedHits,
  searchHits,
  type CommandShortcutGroup,
  type CommandSources,
} from "./command-search";
import { DEFAULT_SETTINGS, type Settings } from "./settings-schema";

const AREAS: readonly CommandArea[] = [
  { id: "appearance", label: "Appearance" },
  { id: "browser", label: "Browser" },
  { id: "terminal", label: "Terminal" },
  { id: "agents", label: "Agents" },
  { id: "links-editor", label: "Links & editor" },
  { id: "shortcuts", label: "Shortcuts" },
  { id: "notifications", label: "Notifications" },
  { id: "about", label: "About" },
  { id: "privacy", label: "Privacy" },
  { id: "reset", label: "Reset" },
];

const SHORTCUTS: readonly CommandShortcutGroup[] = [
  {
    label: "Panes",
    rows: [
      { action: "split-row", label: "Split Vertically" },
      { action: "close-pane", label: "Close Pane" },
    ],
  },
  {
    label: "App",
    rows: [
      { action: "toggle-settings", label: "Settings…" },
      { action: "toggle-sessions", label: "Session History" },
    ],
  },
];

const sources = (settings: Settings = DEFAULT_SETTINGS, reported?: ReportedIssue[]) =>
  ({
    settings,
    areas: AREAS,
    shortcuts: SHORTCUTS,
    platform: "macos",
    reported,
  }) satisfies CommandSources;

/** Close Pane rebound onto Split Vertically's ⌘D: one rebind and one conflict. */
const SPLIT_CHORD = chordsForAction(defaultKeymap("macos"), "split-row")[0];
const CLASH: Settings = {
  ...DEFAULT_SETTINGS,
  keybindings: withOverride(NO_KEYBINDING_OVERRIDES, "macos", "close-pane", [SPLIT_CHORD]),
};

const labels = (hits: readonly CommandHit[]): string[] => hits.map((hit) => hit.label);
const keys = (items: readonly CommandItem[]): string[] => items.map((item) => item.key);

describe("searchHits", () => {
  it("finds nothing for a blank query", () => {
    expect(searchHits("   ", null, sources())).toEqual([]);
  });

  it("puts a label that starts with the query above one that only contains it", () => {
    // The setting is collected before the area; ranking moves the area up.
    expect(labels(searchHits("notification", null, sources()))).toEqual([
      "Notifications",
      "Agent notifications",
    ]);
  });

  it("puts a label match above a keyword-only match", () => {
    // Scrollback matches "history" only through its keywords.
    expect(labels(searchHits("history", null, sources()))).toEqual([
      "Session History",
      "Scrollback",
    ]);
  });

  it("requires every word of the query", () => {
    expect(labels(searchHits("font size", null, sources()))).toEqual(["Font size"]);
    expect(searchHits("font nonsense", null, sources())).toEqual([]);
  });

  it("keeps only the scoped area's rows and drops entries to areas", () => {
    const all = searchHits("agent", null, sources());
    expect(all.some((hit) => hit.kind === "area" && hit.area === "agents")).toBe(true);
    expect(labels(all)).toContain("Agent notifications");

    const agents = searchHits("agent", "agents", sources());
    expect(agents.every((hit) => hit.area === "agents" && hit.kind !== "area")).toBe(true);
    expect(labels(agents)).toContain("Pinned agents");
    expect(labels(searchHits("agent", "notifications", sources()))).toEqual([
      "Agent notifications",
    ]);
    expect(searchHits("agent", "terminal", sources())).toEqual([]);
  });

  it("names an agent by label, id or command", () => {
    const withAider: Settings = {
      ...DEFAULT_SETTINGS,
      customAgents: [{ id: "custom:aider", label: "Aider", command: "aider --model sonnet" }],
    };
    const agentIds = (query: string) =>
      searchHits(query, null, sources(withAider)).flatMap((hit) =>
        hit.kind === "agent" ? [hit.agentId] : [],
      );
    expect(agentIds("claude")).toEqual(["claude"]);
    expect(agentIds("sonnet")).toEqual(["custom:aider"]);
    // A built-in is found by the flags its row shows, not only by its bare id.
    const gemini = BUILTIN_AGENTS.find((agent) => agent.id === "gemini");
    expect(gemini?.defaultCommand).toContain("--yolo");
    expect(agentIds("yolo")).toEqual(["gemini"]);
  });

  it("lists an area once when both its key and its label match", () => {
    for (const query of ["shortcut", "shortcuts"]) {
      const hits = searchHits(query, null, sources());
      expect(
        hits.filter((hit) => hit.id === "area:shortcuts"),
        query,
      ).toHaveLength(1);
      expect(new Set(hits.map((hit) => hit.id)).size, query).toBe(hits.length);
    }
  });

  it("lists every agent when a per-agent key matches, not a row of its own", () => {
    const hits = searchHits("signal", null, sources());
    expect(hits.every((hit) => hit.kind === "agent")).toBe(true);
    expect(hits).toHaveLength(BUILTIN_AGENTS.length);
  });

  it("matches shortcut labels only from the second character", () => {
    expect(searchHits("c", null, sources()).some((hit) => hit.kind === "shortcut")).toBe(false);
    expect(labels(searchHits("cl", null, sources()))).toContain("Close Pane");
  });

  it("offers the Shortcuts area and the rebound or conflicting rows for the shortcuts key", () => {
    const hits = searchHits("hotkey", null, sources(CLASH));
    expect(hits.map((hit) => hit.id).sort()).toEqual([
      "area:shortcuts",
      "shortcut:close-pane",
      "shortcut:split-row",
    ]);
  });

  it("offers a rebound row that conflicts with nothing", () => {
    const unbound: Settings = {
      ...DEFAULT_SETTINGS,
      keybindings: withOverride(NO_KEYBINDING_OVERRIDES, "macos", "close-pane", []),
    };
    expect(
      searchHits("hotkey", null, sources(unbound))
        .map((hit) => hit.id)
        .sort(),
    ).toEqual(["area:shortcuts", "shortcut:close-pane"]);
  });

  it("reads rebinds of the running platform only", () => {
    const windows = { ...sources(CLASH), platform: "windows" };
    expect(searchHits("hotkey", null, windows).map((hit) => hit.id)).toEqual(["area:shortcuts"]);
    expect(changedHits(windows)).toEqual([]);
  });
});

describe("searchHits by chord", () => {
  it("finds an action by the chord it answers to, printed or spelled", () => {
    expect(labels(searchHits("⌘d", null, sources()))).toContain("Split Vertically");
    expect(labels(searchHits("cmd+d", null, sources()))).toContain("Split Vertically");
    expect(labels(searchHits("command d", null, sources()))).toContain("Split Vertically");
  });

  it("follows a rebind: the new chord finds the action, the old one finds it only where still bound", () => {
    expect(labels(searchHits("⌘d", null, sources(CLASH)))).toEqual(
      expect.arrayContaining(["Split Vertically", "Close Pane"]),
    );
    expect(labels(searchHits("⌘w", null, sources(CLASH)))).not.toContain("Close Pane");
  });

  it("finds an action by its Windows chord, and does not read the mac glyphs there", () => {
    const windows = { ...sources(), platform: "windows" };
    expect(labels(searchHits("ctrl+shift+d", null, windows))).toContain("Split Vertically");
    expect(labels(searchHits("⌘d", null, windows))).not.toContain("Split Vertically");
  });

  it("keeps a one-character query out of the shortcut list", () => {
    expect(labels(searchHits("d", null, sources())).includes("Split Vertically")).toBe(false);
  });
});

describe("buildCommandItems with a query", () => {
  it("shows one empty line naming the query when nothing matches", () => {
    expect(buildCommandItems("  zzz ", null, sources())).toEqual([
      { type: "empty", key: "empty", query: "zzz" },
    ]);
  });

  it("heads each area, in the order of its best hit", () => {
    expect(keys(buildCommandItems("notification", null, sources()))).toEqual([
      "head:notifications",
      "area:notifications",
      "setting:agentNotifications",
    ]);
    expect(keys(buildCommandItems("history", null, sources()))).toEqual([
      "head:shortcuts",
      "shortcut:toggle-sessions",
      "head:terminal",
      "setting:scrollback",
    ]);
  });

  it("drops the heads inside an area scope", () => {
    expect(keys(buildCommandItems("show", "appearance", sources()))).toEqual([
      "setting:showPaneBar",
      "setting:showStatusBar",
    ]);
  });
});

describe("home lists (empty field, no scope)", () => {
  it("are empty on a fresh install", () => {
    expect(buildCommandItems("", null, sources())).toEqual([]);
  });

  it("lead with what needs attention, then what changed, in area order", () => {
    const current: Settings = {
      ...CLASH,
      fontSize: 15,
      disabledAgents: ["codex"],
      // Layout and data never show as changed.
      sidebarWidth: 300,
      customAgents: [{ id: "custom:aider", label: "Aider", command: "aider" }],
    };
    expect(keys(buildCommandItems("", null, sources(current)))).toEqual([
      "head:attention",
      `attention:${attentionIssues(sources(current))[0].id}`,
      "head:changed",
      "changed:setting:fontSize",
      "changed:agent:codex",
      "changed:shortcut:close-pane",
    ]);
  });

  it("orders what changed by area, not by the order it was collected in", () => {
    // Settings are collected before agents, but Agents comes before Links & editor.
    const current: Settings = {
      ...DEFAULT_SETTINGS,
      externalAppId: "zed",
      disabledAgents: ["codex"],
    };
    expect(changedHits(sources(current)).map((hit) => hit.id)).toEqual([
      "agent:codex",
      "setting:externalAppId",
    ]);
  });

  it("marks an agent whose model default changed", () => {
    const current: Settings = {
      ...DEFAULT_SETTINGS,
      agentRuntimeDefaults: { claude: { model: "opus", effort: null } },
    };
    expect(changedHits(sources(current)).map((hit) => hit.id)).toEqual(["agent:claude"]);
  });

  it("names the chord and every action claiming it, the newest rebind first", () => {
    const [conflict] = attentionIssues(sources(CLASH));
    expect(conflict).toMatchObject({
      kind: "shortcut-conflict",
      area: "shortcuts",
      chord: SPLIT_CHORD,
      actions: ["close-pane", "split-row"],
    });
  });

  it("sorts reported issues with the conflicts, loudest first", () => {
    const reported: ReportedIssue[] = [
      { kind: "reported", id: "update", severity: "info", area: "about", title: "Update ready" },
      {
        kind: "reported",
        id: "notify",
        severity: "error",
        area: "notifications",
        title: "Notifications blocked",
      },
    ];
    expect(attentionIssues(sources(CLASH, reported)).map((issue) => issue.severity)).toEqual([
      "error",
      "warning",
      "info",
    ]);
  });
});

describe("area scope with an empty field", () => {
  it("lists an area's own rows in registry order", () => {
    expect(keys(buildCommandItems("", "appearance", sources()))).toEqual([
      "setting:fontFamily",
      "setting:fontSize",
      "setting:themeId",
      "setting:showPaneBar",
      "setting:showStatusBar",
      "setting:tabBarPosition",
    ]);
  });

  it("lists every agent, then the agents area's own rows", () => {
    const items = keys(buildCommandItems("", "agents", sources()));
    expect(items).toEqual([
      ...BUILTIN_AGENTS.map((agent) => `agent:${agent.id}`),
      "setting:quickAgentIds",
    ]);
  });

  it("groups shortcuts under their headings", () => {
    expect(keys(buildCommandItems("", "shortcuts", sources()))).toEqual([
      "head:Panes",
      "shortcut:split-row",
      "shortcut:close-pane",
      "head:App",
      "shortcut:toggle-settings",
      "shortcut:toggle-sessions",
    ]);
  });

  it("mounts the section of an area that has no registry rows", () => {
    expect(buildCommandItems("", "about", sources())).toEqual([
      { type: "section", key: "section:about", area: "about" },
    ]);
  });
});

describe("keyboard walk", () => {
  const items = buildCommandItems("", "shortcuts", sources());

  it("highlights the first row until the user moves", () => {
    expect(activeKeyIn(items, null)).toBe("shortcut:split-row");
    expect(activeKeyIn(items, "gone")).toBe("shortcut:split-row");
    expect(moveActive(items, "gone", 1)).toBe("shortcut:close-pane");
  });

  it("steps over headings and stops at either end", () => {
    expect(moveActive(items, "shortcut:close-pane", 1)).toBe("shortcut:toggle-settings");
    expect(moveActive(items, "shortcut:toggle-settings", -1)).toBe("shortcut:close-pane");
    expect(moveActive(items, "shortcut:toggle-sessions", 1)).toBe("shortcut:toggle-sessions");
    expect(moveActive(items, "shortcut:split-row", -1)).toBe("shortcut:split-row");
  });

  it("has nowhere to go in a list with no rows", () => {
    expect(moveActive(buildCommandItems("zzz", null, sources()), null, 1)).toBeNull();
  });

  it("keeps keys unique in every list", () => {
    const current: Settings = { ...CLASH, fontSize: 15 };
    for (const list of [
      buildCommandItems("", null, sources(current)),
      buildCommandItems("agent", null, sources(current)),
      buildCommandItems("", "agents", sources(current)),
    ]) {
      expect(new Set(keys(list)).size).toBe(list.length);
    }
  });
});

it("has one area per Settings category", () => {
  expectTypeOf<CommandAreaId>().toEqualTypeOf<CategoryId>();
});
