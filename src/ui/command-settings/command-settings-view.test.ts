import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The category list imports every section, and the sections reach the terminal and its xterm
// addons; this suite needs only each area's id and label, so it gets a list of just those.
vi.mock("../settings/settings-categories", () => ({
  SETTINGS_CATEGORIES: [
    ["appearance", "Appearance"],
    ["browser", "Browser"],
    ["terminal", "Terminal"],
    ["agents", "Agents"],
    ["links-editor", "Links & editor"],
    ["shortcuts", "Shortcuts"],
    ["notifications", "Notifications"],
    ["about", "About"],
    ["privacy", "Privacy"],
    ["reset", "Reset"],
  ].map(([id, label]) => ({ id, label })),
}));
vi.mock("../../host/store-host", () => ({ Store: { load: vi.fn() } }));

import {
  chordsForAction,
  defaultKeymap,
  NO_KEYBINDING_OVERRIDES,
  withOverride,
} from "../../lib/keybindings";
import { initializeDesktopEnvironment, resetDesktopEnvironmentForTests } from "../../lib/platform";
import { agentHit, settingHit, shortcutHit } from "../../settings/command-hits";
import { attentionIssues } from "../../settings/command-search";
import { DEFAULT_SETTINGS, type Settings } from "../../settings/settings-schema";
import { settings } from "../../settings/settings-store";
import { commandListItems, commandSources, hitValueText, issueText } from "./command-settings-view";

beforeEach(() => {
  initializeDesktopEnvironment({ platform: "macos", homeDir: "/home/test", isDevelopment: false });
  settings.value = DEFAULT_SETTINGS;
});

afterEach(() => {
  resetDesktopEnvironmentForTests();
});

const valueOf = (
  hit: Parameters<typeof hitValueText>[0],
  patch: Partial<Settings> = {},
): string => {
  settings.value = { ...DEFAULT_SETTINGS, ...patch };
  return hitValueText(hit, commandSources());
};

describe("the value a row prints", () => {
  it("reads each control kind the way its own row would", () => {
    expect(valueOf(settingHit("showPaneBar", "appearance"), { showPaneBar: true })).toBe("On");
    expect(valueOf(settingHit("showPaneBar", "appearance"), { showPaneBar: false })).toBe("Off");
    expect(valueOf(settingHit("scrollback", "terminal"), { scrollback: 5000 })).toBe("5k lines");
    expect(valueOf(settingHit("tabBarPosition", "appearance"), { tabBarPosition: "top" })).toBe(
      "Top",
    );
    expect(valueOf(settingHit("fontSize", "appearance"), { fontSize: 15 })).toBe("15px");
    expect(valueOf(settingHit("themeId", "appearance"), { themeId: "deck-light" })).toBe(
      "Deck Light",
    );
    expect(
      valueOf(settingHit("browserHomeUrl", "browser"), { browserHomeUrl: "http://localhost:1" }),
    ).toBe("http://localhost:1");
    expect(valueOf(settingHit("fontFamily", "appearance"), { fontFamily: "Menlo" })).toBe("Menlo");
  });

  it("names the app behind the Open with id, not the id", () => {
    expect(valueOf(settingHit("externalAppId", "links-editor"))).not.toBe(
      DEFAULT_SETTINGS.externalAppId,
    );
  });

  it("counts pinned agents", () => {
    expect(
      valueOf(settingHit("quickAgentIds", "agents"), { quickAgentIds: ["claude", "codex"] }),
    ).toBe("2 pinned");
  });

  it("says whether an agent is on", () => {
    const claude = agentHit({ id: "claude", label: "Claude Code" });
    expect(valueOf(claude)).toBe("On");
    expect(valueOf(claude, { disabledAgents: ["claude"] })).toBe("Off");
  });

  it("prints the chord a shortcut answers to, and Unbound once it has none", () => {
    const hit = shortcutHit({ action: "split-row", label: "Split Vertically" });
    expect(valueOf(hit)).toBe("⌘D");
    const unbound = withOverride(NO_KEYBINDING_OVERRIDES, "macos", "split-row", []);
    expect(valueOf(hit, { keybindings: unbound })).toBe("Unbound");
  });

  it("prints nothing for an entry to an area", () => {
    expect(
      valueOf({ kind: "area", id: "area:terminal", area: "terminal", label: "Terminal" }),
    ).toBe("");
  });
});

describe("the sentence an attention row reads as", () => {
  it("names the chord and both actions that share it", () => {
    const chord = chordsForAction(defaultKeymap("macos"), "split-row")[0];
    settings.value = {
      ...DEFAULT_SETTINGS,
      keybindings: withOverride(NO_KEYBINDING_OVERRIDES, "macos", "close-pane", [chord]),
    };
    const sources = commandSources();
    const [issue] = attentionIssues(sources);
    const text = issueText(issue, sources);
    expect(text).toContain("⌘D is bound to");
    expect(text).toContain("Close Pane");
    expect(text).toContain("Split Vertically");
  });

  it("prints a reported issue as its own title", () => {
    expect(
      issueText(
        { kind: "reported", id: "r", severity: "warning", area: "notifications", title: "Muted" },
        commandSources(),
      ),
    ).toBe("Muted");
  });
});

describe("the list for a query and a scope", () => {
  it("is the area's own section for an area no row edits yet", () => {
    expect(commandListItems("", "privacy", commandSources())).toEqual([
      { type: "section", key: "section:privacy", area: "privacy" },
    ]);
    expect(commandListItems("   ", "privacy", commandSources())).toHaveLength(1);
  });

  it("is a piece of rows for the About and Reset areas", () => {
    expect(commandListItems("", "about", commandSources()).map((item) => item.key)).toEqual([
      "piece:about:about",
    ]);
    expect(commandListItems("", "reset", commandSources()).map((item) => item.key)).toEqual([
      "piece:reset:resets",
    ]);
  });

  it("is the area's live rows behind its reset bar when an area is chosen and nothing is typed", () => {
    expect(commandListItems("", "terminal", commandSources()).map((item) => item.key)).toEqual([
      "piece:terminal:reset",
      "setting:scrollback",
    ]);
  });

  it("puts the colour mode, the preview and the logo into Appearance as legacy pieces", () => {
    const keys = commandListItems("", "appearance", commandSources()).map((item) => item.key);
    expect(keys).toEqual([
      "piece:appearance:reset",
      "piece:appearance:theme",
      "setting:fontFamily",
      "setting:fontSize",
      "piece:appearance:preview",
      "setting:showPaneBar",
      "setting:showStatusBar",
      "setting:tabBarPosition",
      "piece:appearance:logo",
    ]);
  });

  it("is the home list with nothing chosen and nothing typed", () => {
    expect(commandListItems("", null, commandSources())).toEqual([]);
    settings.value = { ...DEFAULT_SETTINGS, scrollback: 1000 };
    expect(commandListItems("", null, commandSources()).map((item) => item.key)).toEqual([
      "head:changed",
      "changed:setting:scrollback",
    ]);
  });

  it("is the matching rows once something is typed, inside the area when one is chosen", () => {
    const all = commandListItems("font", null, commandSources());
    expect(all.some((item) => item.type === "head")).toBe(true);
    const inside = commandListItems("font", "appearance", commandSources());
    expect(inside.length).toBeGreaterThan(0);
    expect(inside.every((item) => item.type === "hit")).toBe(true);
    expect(commandListItems("font", "terminal", commandSources())).toEqual([
      { type: "empty", key: "empty", query: "font" },
    ]);
  });
});
