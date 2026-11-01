// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The sections and pieces an area mounts pull in host-backed stores; stub them for jsdom.
vi.mock("../../host/store-host", () => ({
  Store: {
    load: vi.fn(async () => ({
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => {}),
      save: vi.fn(async () => {}),
      loadState: { state: "ready", fresh: false },
    })),
  },
}));
vi.mock("../../host/dialog-host", () => ({
  open: vi.fn(async () => null),
  ask: vi.fn(async () => true),
}));
vi.mock("../../lib/native-notification", () => ({
  requestAgentNotificationPermission: vi.fn(),
}));
vi.mock("../../chrome/events", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../chrome/events")>();
  return { ...actual, reportPersistError: vi.fn() };
});
vi.mock("../../settings/agent-hooks-support-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../settings/agent-hooks-support-store")>()),
  ensureAgentHooksSupportLoaded: vi.fn(async () => {}),
}));

// The import order is load-bearing: with the kit below these imports, this suite fails at import
// with an xterm "Data error" (tiny-inflate in the unicode-graphemes addon). Root cause unknown.
import {
  clickIn,
  openSurface as open,
  resetCommandSettings,
  rowOf,
} from "./command-settings-test-kit";
import { SETTINGS_PAGES, SETTINGS_REGISTRY } from "../../settings/settings-registry";
import type { Settings } from "../../settings/settings-schema";
import { agentsProbed, detectedAgents } from "../../terminal/agent-detection-store";
import { commandScope } from "./command-settings-state";

/*
 * The cut-over safety net, in the spirit of `settings-registry-rows.test.tsx` for the screen it
 * replaces: every registry key that has a page is edited somewhere on that page of Command
 * Settings, and no area draws a row for a key that belongs to another page. Adding a key to the
 * registry fails the first test until this table gives it a home.
 */

const row = (key: string) => () => rowOf(`setting:${key}`) !== null;
const present = (selector: string) => () => document.querySelector(selector) !== null;

/** The proof that a key is editable on its page, as it would be found by a person. */
const EVIDENCE: Readonly<Record<string, () => boolean>> = {
  // A row of its own.
  fontFamily: row("fontFamily"),
  fontSize: row("fontSize"),
  showPaneBar: row("showPaneBar"),
  showStatusBar: row("showStatusBar"),
  tabBarPosition: row("tabBarPosition"),
  scrollback: row("scrollback"),
  browserHomeUrl: row("browserHomeUrl"),
  externalAppId: row("externalAppId"),
  agentNotifications: row("agentNotifications"),
  quickAgentIds: row("quickAgentIds"),
  // The colour mode is edited by its cards, mounted in place.
  themeId: present('[data-setting="themeId"]'),
  // One shortcut row per rebindable action.
  keybindings: () => rowOf("shortcut:split-row") !== null,
  // An agent's own row and the editors under it (an installed built-in, opened).
  disabledAgents: present('[aria-label="Claude Code availability"]'),
  agentSignalAdapters: present('[aria-label="Claude Code signals"]'),
  defaultLaunchProfiles: present('input[aria-label="Command for Claude Code"]'),
  agentModels: present('input[aria-label="Additional models for Claude Code"]'),
  agentRuntimeDefaults: present('[aria-label="Default effort for Claude Code"]'),
  // The forms no row can draw, mounted in place.
  launchProfiles: present('input[aria-label="Add command"]'),
  customAgents: present('section[aria-label="Agent identities"]'),
};

const pagedKeys = Object.entries(SETTINGS_REGISTRY)
  .filter(([, entry]) => entry.page !== null)
  .map(([key]) => key);

beforeEach(() => {
  resetCommandSettings();
  detectedAgents.value = [{ name: "claude", path: "/bin/claude" }];
  agentsProbed.value = true;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Command Settings ↔ the settings registry", () => {
  it("has a place for exactly the keys the registry files under a page", () => {
    expect(Object.keys(EVIDENCE).sort()).toEqual([...pagedKeys].sort());
  });

  it.each(SETTINGS_PAGES)("page %s edits every key the registry files under it", async (page) => {
    commandScope.value = page;
    await open();
    if (page === "agents") {
      await clickIn(document.querySelector('[aria-label="Configure Claude Code"]'));
    }
    const mine = pagedKeys.filter((key) => SETTINGS_REGISTRY[key as keyof Settings].page === page);
    expect(mine.length).toBeGreaterThan(0);
    for (const key of mine) {
      expect(EVIDENCE[key]?.(), `${key} on ${page}`).toBe(true);
    }
  });

  it.each(SETTINGS_PAGES)("page %s draws no row for another page's key", async (page) => {
    commandScope.value = page;
    await open();
    const drawn = [...document.querySelectorAll('[id^="command-row-setting:"]')].map((el) =>
      el.id.replace("command-row-setting:", ""),
    );
    for (const key of drawn) {
      expect(SETTINGS_REGISTRY[key as keyof Settings].page, `${key} drawn on ${page}`).toBe(page);
    }
  });
});
