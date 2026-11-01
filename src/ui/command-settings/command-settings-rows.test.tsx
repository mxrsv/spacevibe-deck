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

// The import order here is load-bearing: with the kit below these imports, this suite fails at import
// with an xterm "Data error" (tiny-inflate in the unicode-graphemes addon). Root cause unknown.
import {
  clickIn,
  controlOf,
  openSurface as open,
  resetCommandSettings,
  rowLabels,
  rowOf,
  search,
  typeInto,
} from "./command-settings-test-kit";
import { requestAgentNotificationPermission } from "../../lib/native-notification";
import { initializeDesktopEnvironment, resetDesktopEnvironmentForTests } from "../../lib/platform";
import { EXTERNAL_APPS } from "../../lib/external-app-catalog";
import { DEFAULT_SETTINGS } from "../../settings/settings-schema";
import { settings, settingsLoadState } from "../../settings/settings-store";
import { press, settle, visibleByRole, waitUntil } from "../controls/preset-test-kit";
import { commandScope } from "./command-settings-state";

beforeEach(resetCommandSettings);

afterEach(() => {
  vi.restoreAllMocks();
});

const SWITCH = "[role=switch]";
const MENU = "[role=combobox]";

/** Opens a row's menu and picks an item by its text. */
async function pick(key: string, label: string): Promise<void> {
  await clickIn(controlOf(key, MENU));
  const option = [...document.body.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (item) => item.textContent === label,
  );
  expect(option, `option ${label}`).toBeDefined();
  await clickIn(option);
  await waitUntil(() => visibleByRole("listbox") === null);
}

const changedMark = (key: string): boolean => rowOf(key)?.textContent?.includes("Changed") === true;

describe("a switch row", () => {
  it("flips its setting from the area view, marks the change, and resets to the default", async () => {
    commandScope.value = "appearance";
    await open();
    expect(controlOf("setting:showPaneBar", SWITCH).getAttribute("aria-checked")).toBe("false");

    await clickIn(controlOf("setting:showPaneBar", SWITCH));
    expect(settings.value.showPaneBar).toBe(true);
    expect(changedMark("setting:showPaneBar")).toBe(true);

    await clickIn(rowOf("setting:showPaneBar")?.querySelector("button[aria-label^='Reset']"));
    expect(settings.value.showPaneBar).toBe(DEFAULT_SETTINGS.showPaneBar);
    expect(changedMark("setting:showPaneBar")).toBe(false);
  });

  it("flips its setting from a search hit", async () => {
    await open();
    await typeInto(search(), "status bar");
    expect(rowLabels()[0]).toBe("Show status bar");
    await clickIn(controlOf("setting:showStatusBar", SWITCH));
    expect(settings.value.showStatusBar).toBe(true);
  });

  it("asks the host before it turns agent notifications on", async () => {
    settings.value = { ...DEFAULT_SETTINGS, agentNotifications: false };
    commandScope.value = "notifications";
    await open();

    vi.mocked(requestAgentNotificationPermission).mockResolvedValue(false);
    await clickIn(controlOf("setting:agentNotifications", SWITCH));
    await settle();
    expect(requestAgentNotificationPermission).toHaveBeenCalledTimes(1);
    expect(settings.value.agentNotifications).toBe(false);

    vi.mocked(requestAgentNotificationPermission).mockResolvedValue(true);
    await clickIn(controlOf("setting:agentNotifications", SWITCH));
    await settle();
    expect(settings.value.agentNotifications).toBe(true);

    await clickIn(controlOf("setting:agentNotifications", SWITCH));
    expect(settings.value.agentNotifications).toBe(false);
    expect(requestAgentNotificationPermission).toHaveBeenCalledTimes(2);
  });
});

describe("a choice row", () => {
  it("sets one of two segments, and keeps the value when the chosen one is pressed again", async () => {
    commandScope.value = "appearance";
    await open();
    const top = () =>
      document.querySelector<HTMLElement>('button[aria-label="Tab bar position: Top"]');
    await clickIn(top());
    expect(settings.value.tabBarPosition).toBe("top");
    await clickIn(top());
    expect(settings.value.tabBarPosition).toBe("top");
  });

  it("picks from a menu and writes the stored type", async () => {
    commandScope.value = "terminal";
    await open();
    await pick("setting:scrollback", "5k lines");
    expect(settings.value.scrollback).toBe(5000);
  });
});

describe("a stepper row", () => {
  it("applies a size inside the bounds as it is typed and refuses one outside", async () => {
    commandScope.value = "appearance";
    await open();
    const field = controlOf("setting:fontSize", "input") as HTMLInputElement;
    field.focus();

    await typeInto(field, "18");
    expect(settings.value.fontSize).toBe(18);
    await typeInto(field, "99");
    expect(settings.value.fontSize).toBe(18);
    await typeInto(field, "9");
    expect(settings.value.fontSize).toBe(18);

    field.blur();
    await settle();
    expect(field.value).toBe("18");
  });

  it("restores the saved size on Escape and keeps the surface open", async () => {
    commandScope.value = "appearance";
    const { onClose } = await open();
    const field = controlOf("setting:fontSize", "input") as HTMLInputElement;
    field.focus();
    await typeInto(field, "99");
    await press(field, { key: "Escape" });
    expect(field.value).toBe(String(DEFAULT_SETTINGS.fontSize));
    expect(commandScope.value).toBe("appearance");
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("a text row", () => {
  it("commits on Enter and on blur, and a refused empty value shows the saved one", async () => {
    commandScope.value = "browser";
    await open();
    const field = controlOf("setting:browserHomeUrl", "input") as HTMLInputElement;
    field.focus();

    await typeInto(field, "http://localhost:4000");
    expect(settings.value.browserHomeUrl).toBe(DEFAULT_SETTINGS.browserHomeUrl);
    await press(field, { key: "Enter" });
    expect(settings.value.browserHomeUrl).toBe("http://localhost:4000");

    await typeInto(field, "http://localhost:5000");
    field.blur();
    await settle();
    expect(settings.value.browserHomeUrl).toBe("http://localhost:5000");

    field.focus();
    await typeInto(field, "  ");
    field.blur();
    await settle();
    expect(field.value).toBe("http://localhost:5000");
  });
});

describe("a menu row", () => {
  it("picks a font from the installed faces", async () => {
    commandScope.value = "appearance";
    await open();
    await pick("setting:fontFamily", "Menlo");
    expect(settings.value.fontFamily).toBe("Menlo");
  });

  it("takes any family from the custom field", async () => {
    commandScope.value = "appearance";
    await open();
    await pick("setting:fontFamily", "Custom…");
    const field = rowOf("setting:fontFamily")?.querySelector(
      'input[aria-label="Custom font name"]',
    ) as HTMLInputElement;
    field.focus();
    await typeInto(field, '"Iosevka", monospace');
    await press(field, { key: "Enter" });
    expect(settings.value.fontFamily).toBe('"Iosevka", monospace');
  });

  it("picks the app a path opens in", async () => {
    commandScope.value = "links-editor";
    await open();
    const next = EXTERNAL_APPS.find((app) => app.id !== DEFAULT_SETTINGS.externalAppId);
    await pick("setting:externalAppId", next?.label ?? "");
    expect(settings.value.externalAppId).toBe(next?.id);
  });
});

describe("the app menu where the host cannot open other apps", () => {
  afterEach(resetDesktopEnvironmentForTests);

  it("keeps its place with the reason, and offers no menu", async () => {
    initializeDesktopEnvironment({
      platform: "windows",
      homeDir: "C:\\Users\\test",
      isDevelopment: false,
    });
    commandScope.value = "links-editor";
    await open();
    const trigger = controlOf("setting:externalAppId", "button[aria-label='Open with']");
    expect(trigger.getAttribute("aria-disabled")).toBe("true");
    expect(trigger.getAttribute("title")).toBe("Not available on Windows");
    await clickIn(trigger);
    expect(visibleByRole("listbox")).toBeNull();
  });
});

describe("the changed list", () => {
  it("shows an edited key as a live row, and the focus stays in the surface when its reset removes it", async () => {
    await open();
    expect(rowLabels()).toEqual([]);

    settings.value = { ...DEFAULT_SETTINGS, showStatusBar: true };
    await settle();
    expect(rowLabels()).toEqual(["Show status bar"]);
    expect(rowOf("changed:setting:showStatusBar")?.textContent).toContain("Appearance");

    const reset = rowOf("changed:setting:showStatusBar")?.querySelector<HTMLElement>(
      "button[aria-label^='Reset']",
    );
    reset?.focus();
    await clickIn(reset);
    expect(settings.value.showStatusBar).toBe(false);
    expect(rowLabels()).toEqual([]);
    expect(document.activeElement).toBe(search());
  });

  it("goes into the control on Enter and never flips it", async () => {
    settings.value = { ...DEFAULT_SETTINGS, showPaneBar: true };
    await open();
    await press(search(), { key: "Enter" });
    expect(document.activeElement).toBe(controlOf("changed:setting:showPaneBar", SWITCH));
    expect(settings.value.showPaneBar).toBe(true);
  });
});

describe("an area view", () => {
  it("keeps the content no row can draw reachable, and the page reset", async () => {
    settings.value = { ...DEFAULT_SETTINGS, fontSize: 16 };
    commandScope.value = "appearance";
    await open();
    for (const name of ["Color mode", "Typography preview", "Identity"]) {
      expect(document.querySelector(`section[aria-label="${name}"]`), name).not.toBeNull();
    }
    expect(document.body.textContent).toContain("1 changed");
  });
});

describe("a row while the snapshot loads", () => {
  it("ignores every kind of control", async () => {
    settingsLoadState.value = { status: "loading" };
    commandScope.value = "appearance";
    await open();

    await clickIn(controlOf("setting:showPaneBar", SWITCH));
    await clickIn(document.querySelector('button[aria-label="Tab bar position: Top"]'));
    await clickIn(controlOf("setting:fontFamily", MENU));
    // A disabled field takes no typing from a user; the element itself is the lock.
    const field = controlOf("setting:fontSize", "input") as HTMLInputElement;

    expect(visibleByRole("listbox")).toBeNull();
    expect(field.disabled).toBe(true);
    expect(settings.value.showPaneBar).toBe(DEFAULT_SETTINGS.showPaneBar);
    expect(settings.value.tabBarPosition).toBe(DEFAULT_SETTINGS.tabBarPosition);
    expect(settings.value.fontFamily).toBe(DEFAULT_SETTINGS.fontFamily);
    expect(settings.value.fontSize).toBe(DEFAULT_SETTINGS.fontSize);
  });
});
