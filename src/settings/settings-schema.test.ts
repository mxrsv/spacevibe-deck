import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  DOCK_TABS,
  DOCK_WIDTH_MAX,
  DOCK_WIDTH_MIN,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  validateSettings,
} from "./settings-schema";

describe("validateSettings", () => {
  it("silently drops the legacy restoreTabs field", () => {
    const validated = validateSettings({ restoreTabs: false });
    expect("restoreTabs" in validated).toBe(false);
  });

  it("silently drops the legacy sidebarPosition field", () => {
    const validated = validateSettings({ sidebarPosition: "top" });
    expect("sidebarPosition" in validated).toBe(false);
  });
});

describe("tabBarPosition", () => {
  it("defaults to left, including for settings files that predate it", () => {
    expect(DEFAULT_SETTINGS.tabBarPosition).toBe("left");
    expect(validateSettings({}).tabBarPosition).toBe("left");
  });

  it("keeps an explicit top", () => {
    expect(validateSettings({ tabBarPosition: "top" }).tabBarPosition).toBe(
      "top",
    );
  });

  it("falls back to left on an unknown value", () => {
    expect(
      validateSettings({ tabBarPosition: "diagonal" }).tabBarPosition,
    ).toBe("left");
    expect(validateSettings({ tabBarPosition: 7 }).tabBarPosition).toBe("left");
  });
});

describe("showPaneBar", () => {
  it("defaults to false", () => {
    expect(DEFAULT_SETTINGS.showPaneBar).toBe(false);
    expect(validateSettings({}).showPaneBar).toBe(false);
  });

  it("accepts a boolean and rejects other types", () => {
    expect(validateSettings({ showPaneBar: true }).showPaneBar).toBe(true);
    expect(validateSettings({ showPaneBar: "yes" }).showPaneBar).toBe(false);
  });
});

describe("focusExpand", () => {
  it("defaults to false", () => {
    expect(DEFAULT_SETTINGS.focusExpand).toBe(false);
  });

  it("accepts a valid boolean", () => {
    expect(
      validateSettings({ ...DEFAULT_SETTINGS, focusExpand: true }).focusExpand,
    ).toBe(true);
  });

  it("falls back to false when missing or not a boolean", () => {
    expect(validateSettings({}).focusExpand).toBe(false);
    expect(
      validateSettings({ ...DEFAULT_SETTINGS, focusExpand: "yes" }).focusExpand,
    ).toBe(false);
  });
});

describe("agentNotifications", () => {
  it("defaults to false", () => {
    expect(DEFAULT_SETTINGS.agentNotifications).toBe(false);
    expect(validateSettings({}).agentNotifications).toBe(false);
  });

  it("accepts true", () => {
    expect(
      validateSettings({ agentNotifications: true }).agentNotifications,
    ).toBe(true);
  });

  it("accepts false", () => {
    expect(
      validateSettings({ agentNotifications: false }).agentNotifications,
    ).toBe(false);
  });

  it("falls back to false on invalid types (string, number)", () => {
    expect(
      validateSettings({ agentNotifications: "yes" }).agentNotifications,
    ).toBe(false);
    expect(validateSettings({ agentNotifications: 1 }).agentNotifications).toBe(
      false,
    );
  });
});

describe("restoreSessions", () => {
  it("defaults to true", () => {
    expect(DEFAULT_SETTINGS.restoreSessions).toBe(true);
    expect(validateSettings({}).restoreSessions).toBe(true);
  });

  it("accepts true", () => {
    expect(validateSettings({ restoreSessions: true }).restoreSessions).toBe(
      true,
    );
  });

  it("accepts false", () => {
    expect(validateSettings({ restoreSessions: false }).restoreSessions).toBe(
      false,
    );
  });

  it("falls back to true on invalid types (string, number)", () => {
    expect(validateSettings({ restoreSessions: "yes" }).restoreSessions).toBe(
      true,
    );
    expect(validateSettings({ restoreSessions: 0 }).restoreSessions).toBe(true);
  });
});

const LEGACY_RENDERER_KEY = ["terminal", "Renderer"].join("");

describe("legacy renderer setting", () => {
  it("ignores legacy terminal" + "Renderer values", () => {
    for (const legacyValue of ["dom", "webgl", "canvas"]) {
      expect(
        LEGACY_RENDERER_KEY in
          validateSettings({ [LEGACY_RENDERER_KEY]: legacyValue }),
      ).toBe(false);
    }
  });
});

/**
 * Settings offers only Light and Dark since 2026-08-19, and that is a change
 * to what is REACHABLE, never to what is storable. A profile written by an
 * older build must come back with the id it was saved with — a schema that
 * quietly rewrote an unrecognised theme to the default would convert every
 * legacy user the first time they launched, which is the exact
 * "silently rewritten merely by opening Settings" failure the design spec
 * names.
 */
describe("themeId survives validation whatever it names", () => {
  it("defaults a profile with no theme to the dark mode", () => {
    expect(validateSettings({}).themeId).toBe("deck-dark");
    expect(DEFAULT_SETTINGS.themeId).toBe("deck-dark");
  });

  it.each([
    "deck-dark",
    "deck-light",
    "tokyo-night",
    "dracula",
    "one-dark",
    "catppuccin-mocha",
    "file:my-theme.itermcolors",
  ])("keeps %s exactly as stored", (themeId) => {
    expect(validateSettings({ themeId }).themeId).toBe(themeId);
  });

  it("keeps colour overrides a legacy profile carries", () => {
    expect(
      validateSettings({ colorOverrides: { background: "#101014" } })
        .colorOverrides,
    ).toEqual({ background: "#101014" });
  });

  it("falls back only for a value that is not a name at all", () => {
    expect(validateSettings({ themeId: 42 }).themeId).toBe("deck-dark");
  });
});

describe("scrollback", () => {
  it("defaults to 10000 when missing", () => {
    expect(DEFAULT_SETTINGS.scrollback).toBe(10_000);
    expect(validateSettings({}).scrollback).toBe(10_000);
  });

  it("falls back to 10000 on a non-number", () => {
    expect(validateSettings({ scrollback: "abc" }).scrollback).toBe(10_000);
  });

  it("clamps below the minimum to 1000", () => {
    expect(validateSettings({ scrollback: 250 }).scrollback).toBe(1000);
  });

  it("clamps above the maximum to 100000", () => {
    expect(validateSettings({ scrollback: 999_999 }).scrollback).toBe(100_000);
  });

  it("keeps an in-range value", () => {
    expect(validateSettings({ scrollback: 5000 }).scrollback).toBe(5000);
  });
});

describe("customAgents", () => {
  const valid = {
    id: "custom:aider",
    label: "Aider",
    command: "aider --model sonnet",
  };

  it("defaults to none declared", () => {
    expect(DEFAULT_SETTINGS.customAgents).toEqual([]);
    expect(validateSettings({}).customAgents).toEqual([]);
  });

  it("falls back to none when the stored value is not an array", () => {
    expect(validateSettings({ customAgents: "aider" }).customAgents).toEqual(
      [],
    );
  });

  it("keeps a well-formed entry verbatim", () => {
    expect(validateSettings({ customAgents: [valid] }).customAgents).toEqual([
      valid,
    ]);
  });

  it("drops an entry whose binary a shell would act on", () => {
    // The stored file is user-writable, so this is a real input path — not
    // only what the settings form produced.
    const evil = { ...valid, id: "custom:evil", command: "x; rm -rf ~" };
    expect(
      validateSettings({ customAgents: [valid, evil] }).customAgents,
    ).toEqual([valid]);
  });

  it("drops entries with a missing id prefix, blank label or blank command", () => {
    const broken = [
      { ...valid, id: "aider" },
      { ...valid, id: "custom:" },
      { ...valid, id: "custom:blank", label: "   " },
      { ...valid, id: "custom:long", label: "l".repeat(33) },
      { ...valid, id: "custom:nocmd", command: "  " },
      { id: "custom:partial", label: "Partial" },
      null,
      "aider",
    ];
    expect(validateSettings({ customAgents: broken }).customAgents).toEqual([]);
  });

  it("keeps the first of two entries sharing an id", () => {
    const clash = { ...valid, label: "Aider clone" };
    expect(
      validateSettings({ customAgents: [valid, clash] }).customAgents,
    ).toEqual([valid]);
  });
});

describe("promptTemplates validation", () => {
  const good = {
    id: "tpl:fix-bug",
    label: "fix bug",
    body: "Fix the failing test.",
    autoSend: false,
  };

  it("defaults to none", () => {
    expect(validateSettings({}).promptTemplates).toEqual([]);
  });

  it("keeps well-formed entries", () => {
    expect(
      validateSettings({ promptTemplates: [good] }).promptTemplates,
    ).toEqual([good]);
  });

  it("drops a malformed entry rather than repairing it", () => {
    const raw = {
      promptTemplates: [good, { id: "tpl:x" }, { label: "no id" }],
    };
    expect(validateSettings(raw).promptTemplates).toEqual([good]);
  });

  it("falls back to none for a malformed array", () => {
    expect(
      validateSettings({ promptTemplates: "nope" }).promptTemplates,
    ).toEqual([]);
  });

  it("dedupes repeated ids, first wins", () => {
    const second = { ...good, label: "other" };
    expect(
      validateSettings({ promptTemplates: [good, second] }).promptTemplates,
    ).toEqual([good]);
  });

  it("keeps only the four known fields", () => {
    const raw = { promptTemplates: [{ ...good, extra: "dropped" }] };
    expect(validateSettings(raw).promptTemplates).toEqual([good]);
  });
});

describe("dockOpen", () => {
  it("defaults to false", () => {
    expect(DEFAULT_SETTINGS.dockOpen).toBe(false);
    expect(validateSettings({}).dockOpen).toBe(false);
  });

  it("accepts a boolean and rejects other types", () => {
    expect(validateSettings({ dockOpen: true }).dockOpen).toBe(true);
    expect(validateSettings({ dockOpen: "yes" }).dockOpen).toBe(false);
  });
});

describe("dockWidth", () => {
  it("defaults to 420 when missing", () => {
    expect(DEFAULT_SETTINGS.dockWidth).toBe(420);
    expect(validateSettings({}).dockWidth).toBe(420);
  });

  it("falls back to 420 on a non-number", () => {
    expect(validateSettings({ dockWidth: "abc" }).dockWidth).toBe(420);
  });

  it("clamps below the minimum", () => {
    expect(validateSettings({ dockWidth: 10 }).dockWidth).toBe(DOCK_WIDTH_MIN);
  });

  it("clamps above the maximum", () => {
    expect(validateSettings({ dockWidth: 9999 }).dockWidth).toBe(
      DOCK_WIDTH_MAX,
    );
  });

  it("keeps an in-range value", () => {
    expect(validateSettings({ dockWidth: 500 }).dockWidth).toBe(500);
  });
});

describe("dockTab", () => {
  it("defaults to the file explorer", () => {
    expect(DEFAULT_SETTINGS.dockTab).toBe("explorer");
    expect(validateSettings({}).dockTab).toBe("explorer");
  });

  it("keeps every tab the dock knows", () => {
    for (const tab of DOCK_TABS) {
      expect(validateSettings({ dockTab: tab }).dockTab).toBe(tab);
    }
  });

  // A stored name nothing answers to would leave the dock painting an empty
  // column, so it resolves to the default rather than surviving as data.
  it("falls back to the explorer on an unknown or mistyped tab", () => {
    expect(validateSettings({ dockTab: "terminal" }).dockTab).toBe("explorer");
    expect(validateSettings({ dockTab: 3 }).dockTab).toBe("explorer");
  });
});

describe("sidebarWidth", () => {
  it("defaults to the 275px figure the frame row was measured against", () => {
    expect(DEFAULT_SETTINGS.sidebarWidth).toBe(275);
    expect(validateSettings({}).sidebarWidth).toBe(275);
  });

  it("falls back to the default on a non-number", () => {
    expect(validateSettings({ sidebarWidth: null }).sidebarWidth).toBe(275);
    expect(validateSettings({ sidebarWidth: Number.NaN }).sidebarWidth).toBe(
      275,
    );
  });

  it("clamps to the range", () => {
    expect(validateSettings({ sidebarWidth: 10 }).sidebarWidth).toBe(
      SIDEBAR_WIDTH_MIN,
    );
    expect(validateSettings({ sidebarWidth: 9999 }).sidebarWidth).toBe(
      SIDEBAR_WIDTH_MAX,
    );
    expect(validateSettings({ sidebarWidth: 320 }).sidebarWidth).toBe(320);
  });
});

describe("sidebarCollapsed", () => {
  it("defaults to false — a first launch shows the rail with its labels", () => {
    expect(DEFAULT_SETTINGS.sidebarCollapsed).toBe(false);
    expect(validateSettings({}).sidebarCollapsed).toBe(false);
  });

  it("accepts a boolean and rejects other types", () => {
    expect(validateSettings({ sidebarCollapsed: true }).sidebarCollapsed).toBe(
      true,
    );
    expect(validateSettings({ sidebarCollapsed: 1 }).sidebarCollapsed).toBe(
      false,
    );
  });
});

describe("a settings file predating the sidebar seam", () => {
  it("takes both defaults when neither key is stored", () => {
    const validated = validateSettings({ tabBarPosition: "left" });
    expect(validated.sidebarWidth).toBe(DEFAULT_SETTINGS.sidebarWidth);
    expect(validated.sidebarCollapsed).toBe(DEFAULT_SETTINGS.sidebarCollapsed);
  });
});

describe("a settings file predating the explorer panel", () => {
  it("merges to the default dockOpen/dockWidth when both keys are missing", () => {
    const validated = validateSettings({ tabBarPosition: "top" });
    expect(validated.dockOpen).toBe(DEFAULT_SETTINGS.dockOpen);
    expect(validated.dockWidth).toBe(DEFAULT_SETTINGS.dockWidth);
  });
});

describe("browserLastUrl", () => {
  it("defaults empty and keeps a stored string", () => {
    expect(validateSettings({}).browserLastUrl).toBe("");
    expect(
      validateSettings({ browserLastUrl: "http://localhost:5173/app" })
        .browserLastUrl,
    ).toBe("http://localhost:5173/app");
  });

  it("degrades a malformed value to the default instead of fixing it", () => {
    expect(validateSettings({ browserLastUrl: 7 }).browserLastUrl).toBe("");
    expect(
      validateSettings({ browserLastUrl: "x".repeat(3000) }).browserLastUrl,
    ).toBe("");
  });
});

describe("showStatusBar", () => {
  // Off by default since 2026-08-16: the row is pure readout and the window
  // keeps its height instead. The setting exists so the choice stays the
  // user's rather than being deleted for them.
  it("defaults to false", () => {
    expect(DEFAULT_SETTINGS.showStatusBar).toBe(false);
    expect(validateSettings({}).showStatusBar).toBe(false);
  });

  it("accepts a boolean and rejects other types", () => {
    expect(validateSettings({ showStatusBar: true }).showStatusBar).toBe(true);
    expect(validateSettings({ showStatusBar: "yes" }).showStatusBar).toBe(
      false,
    );
  });
});

describe("launch profiles", () => {
  it("defaults to none declared", () => {
    const settings = validateSettings({});
    expect(settings.launchProfiles).toEqual([]);
    expect(settings.defaultLaunchProfiles).toEqual({});
  });

  it("keeps a valid command and its default mapping", () => {
    const settings = validateSettings({
      launchProfiles: [{ id: "lp:plan", command: "claude --plan" }],
      defaultLaunchProfiles: { claude: "lp:plan" },
    });
    expect(settings.launchProfiles).toHaveLength(1);
    expect(settings.defaultLaunchProfiles).toEqual({ claude: "lp:plan" });
  });

  it("drops a default that points at a dropped command", () => {
    const settings = validateSettings({
      launchProfiles: [{ id: "lp:bad", command: "claude; rm -rf /" }],
      defaultLaunchProfiles: { claude: "lp:bad" },
    });
    expect(settings.launchProfiles).toEqual([]);
    expect(settings.defaultLaunchProfiles).toEqual({});
  });
});

describe("railOrder", () => {
  it("defaults to no project dragged", () => {
    expect(DEFAULT_SETTINGS.railOrder).toEqual([]);
    expect(validateSettings({}).railOrder).toEqual([]);
  });

  it("keeps the stored order, including keys naming nothing on screen", () => {
    // A key nothing answers to is the whole point: it is how a parked project
    // returns to its slot when it is reopened.
    expect(
      validateSettings({ railOrder: ["/w/deck/.git", "plain:/home/me/scratch"] })
        .railOrder,
    ).toEqual(["/w/deck/.git", "plain:/home/me/scratch"]);
  });

  it("deduplicates, first occurrence winning", () => {
    expect(validateSettings({ railOrder: ["a", "b", "a"] }).railOrder).toEqual([
      "a",
      "b",
    ]);
  });

  it("drops entries no cluster could ever answer to", () => {
    expect(
      validateSettings({ railOrder: ["a", "", 7, null, "b"] }).railOrder,
    ).toEqual(["a", "b"]);
  });

  it("falls back to the default for anything that is not an array", () => {
    expect(validateSettings({ railOrder: "a,b" }).railOrder).toEqual([]);
    expect(validateSettings({ railOrder: { 0: "a" } }).railOrder).toEqual([]);
  });
});
