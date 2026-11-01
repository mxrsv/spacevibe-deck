// @vitest-environment jsdom
import { act } from "preact/test-utils";
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
vi.mock("../../host/menu-host", () => ({ suspendMenuAccelerators: vi.fn(async () => {}) }));
vi.mock("../../lib/native-notification", () => ({
  requestAgentNotificationPermission: vi.fn(),
}));
vi.mock("../../chrome/events", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../chrome/events")>();
  return { ...actual, reportPersistError: vi.fn() };
});

// The import order is load-bearing: with the kit below these imports, this suite fails at import
// with an xterm "Data error" (tiny-inflate in the unicode-graphemes addon). Root cause unknown.
import {
  activeRow,
  badge,
  clickIn,
  openSurface as open,
  resetCommandSettings,
  rowLabels,
  rowOf,
  scrolled,
  search,
  typeInto,
} from "./command-settings-test-kit";
import { shortcutCaptureActive } from "../../chrome/events";
import { NO_KEYBINDING_OVERRIDES, withOverride } from "../../lib/keybindings";
import { DEFAULT_SETTINGS } from "../../settings/settings-schema";
import { settings, settingsLoadState } from "../../settings/settings-store";
import { matchBinding } from "../../terminal/keymap";
import { resetActiveKeymapCache } from "../../terminal/active-keymap";
import { press, settle } from "../controls/preset-test-kit";
import { commandScope } from "./command-settings-state";

beforeEach(() => {
  resetCommandSettings();
  resetActiveKeymapCache();
  shortcutCaptureActive.value = false;
  commandScope.value = "shortcuts";
});

afterEach(() => {
  shortcutCaptureActive.value = false;
  vi.restoreAllMocks();
});

const keyEvent = (
  key: string,
  mods: Partial<Pick<KeyboardEvent, "metaKey" | "shiftKey" | "altKey" | "ctrlKey">> = {},
): KeyboardEvent => new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...mods });

/** The press that records: the button of a row, by what it is called. */
const recordButton = (action: string, label: string, verb = "Change"): HTMLElement =>
  rowOf(`shortcut:${action}`)?.querySelector(
    `button[aria-label="${verb} ${label} shortcut"]`,
  ) as HTMLElement;

async function keydown(target: EventTarget, event: KeyboardEvent): Promise<void> {
  await act(async () => {
    target.dispatchEvent(event);
  });
  await settle();
}

/** Close Pane's shipped chord is ⌘W; Find… sits on ⌘D, the chord Split Vertically ships with. */
const FIND_ON_SPLIT = {
  ...DEFAULT_SETTINGS,
  keybindings: withOverride(NO_KEYBINDING_OVERRIDES, "macos", "find", [{ key: "d", meta: true }]),
};

/** The key caps of a row, by its list key. */
const caps = (rowKey: string): string[] =>
  [...(rowOf(rowKey)?.querySelectorAll("kbd[data-slot='kbd']") ?? [])].map(
    (cap) => cap.textContent ?? "",
  );

describe("a shortcut row", () => {
  it("lists every group with its actions, each as a live row", async () => {
    await open();
    const heads = [...document.querySelectorAll("h3")].map((head) => head.textContent);
    expect(heads.slice(0, 3)).toEqual(["Panes", "Tabs", "Layout presets"]);
    expect(rowOf("shortcut:split-row")).not.toBeNull();
    expect(caps("shortcut:split-row")).toEqual(["⌘", "D"]);
    expect(recordButton("split-row", "Split Vertically")).not.toBeNull();
  });

  it("records a chord, makes it the one that fires, and marks the row changed", async () => {
    await open();
    expect(rowOf("shortcut:find")?.textContent).not.toContain("Changed");
    await clickIn(recordButton("find", "Find…"));
    expect(shortcutCaptureActive.value).toBe(true);
    expect(rowOf("shortcut:find")?.textContent).toContain("press keys…");

    await keydown(window, keyEvent("j", { metaKey: true, altKey: true }));

    expect(settings.value.keybindings.macos.find).toEqual([
      { key: "j", meta: true, alt: true, shift: false, ctrl: false },
    ]);
    expect(matchBinding(keyEvent("j", { metaKey: true, altKey: true }))).toBe("find");
    expect(matchBinding(keyEvent("f", { metaKey: true }))).toBeNull();
    expect(shortcutCaptureActive.value).toBe(false);
    expect(caps("shortcut:find")).toEqual(["⌘", "⌥", "J"]);
    expect(rowOf("shortcut:find")?.textContent).toContain("Changed");
  });

  it("unbinds on a bare Backspace", async () => {
    await open();
    await clickIn(recordButton("find", "Find…"));
    await keydown(window, keyEvent("Backspace"));
    expect(settings.value.keybindings.macos.find).toEqual([]);
    expect(rowOf("shortcut:find")?.textContent).toContain("Unbound");
    expect(recordButton("find", "Find…", "Record")).not.toBeNull();
  });

  it("puts the shipped chord back with the row's reset, and the mark clears", async () => {
    settings.value = {
      ...DEFAULT_SETTINGS,
      keybindings: withOverride(NO_KEYBINDING_OVERRIDES, "macos", "find", [
        { key: "j", meta: true },
      ]),
    };
    await open();
    expect(rowOf("shortcut:split-row")?.querySelector("button[aria-label^='Reset']")).toBeNull();

    await clickIn(rowOf("shortcut:find")?.querySelector("button[aria-label^='Reset']"));
    // Cleared, not emptied: "reset to default" and "unbind" are different outcomes.
    expect(settings.value.keybindings.macos.find).toBeUndefined();
    expect(caps("shortcut:find")).toEqual(["⌘", "F"]);
    expect(rowOf("shortcut:find")?.textContent).not.toContain("Changed");
  });

  it("ends a recording when focus leaves the button", async () => {
    await open();
    const button = recordButton("find", "Find…");
    await clickIn(button);
    button.focus();
    expect(shortcutCaptureActive.value).toBe(true);
    search().focus();
    await settle();
    expect(shortcutCaptureActive.value).toBe(false);
  });
});

describe("recording keeps the keyboard", () => {
  it("takes Escape to cancel, and neither closes Settings nor reaches a window listener", async () => {
    const { onClose } = await open();
    const seen = vi.fn();
    window.addEventListener("keydown", seen);
    const button = recordButton("find", "Find…");
    button.focus();
    await clickIn(button);

    await keydown(button, keyEvent("Escape"));

    window.removeEventListener("keydown", seen);
    expect(shortcutCaptureActive.value).toBe(false);
    expect(settings.value.keybindings.macos.find).toBeUndefined();
    expect(onClose).not.toHaveBeenCalled();
    expect(commandScope.value).toBe("shortcuts");
    expect(seen).not.toHaveBeenCalled();
    // Recording is over, so the next Escape is the surface's: back to the search field.
    await press(button, { key: "Escape" });
    expect(document.activeElement).toBe(search());
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not let the arrows or Enter of a recording move the list", async () => {
    await open();
    const before = activeRow();
    const button = recordButton("find", "Find…");
    button.focus();
    await clickIn(button);
    await keydown(button, keyEvent("ArrowDown"));
    await keydown(button, keyEvent("Enter"));
    expect(activeRow()).toBe(before);
    expect(shortcutCaptureActive.value).toBe(true);
  });

  it("goes into the Change button on Enter without starting a recording", async () => {
    await open();
    await typeInto(search(), "find");
    expect(activeRow()).toBe(rowOf("shortcut:find"));
    await press(search(), { key: "Enter" });
    expect(document.activeElement).toBe(recordButton("find", "Find…"));
    expect(shortcutCaptureActive.value).toBe(false);
  });
});

describe("a chord collision", () => {
  it("names the other action on both rows", async () => {
    settings.value = FIND_ON_SPLIT;
    await open();
    expect(rowOf("shortcut:find")?.textContent).toContain("Also bound to Split Vertically");
    expect(rowOf("shortcut:split-row")?.textContent).toContain("Also bound to Find…");
    expect(rowOf("shortcut:close-pane")?.textContent).not.toContain("Also bound");
  });

  it("appears when the user records onto a taken chord, and the newest choice fires until it is resolved", async () => {
    await open();
    await clickIn(recordButton("find", "Find…"));
    await keydown(window, keyEvent("d", { metaKey: true }));

    expect(rowOf("shortcut:find")?.textContent).toContain("Also bound to Split Vertically");
    expect(rowOf("shortcut:split-row")?.textContent).toContain("Also bound to Find…");
    expect(matchBinding(keyEvent("d", { metaKey: true }))).toBe("find");

    await clickIn(rowOf("shortcut:find")?.querySelector("button[aria-label^='Reassign']"));
    expect(document.body.textContent).not.toContain("Also bound");
    expect(matchBinding(keyEvent("d", { metaKey: true }))).toBe("find");
  });

  it("Reassign on a row keeps the chord there and takes it from the other action", async () => {
    settings.value = FIND_ON_SPLIT;
    await open();
    await clickIn(rowOf("shortcut:split-row")?.querySelector("button[aria-label^='Reassign']"));

    // Find loses ⌘D, which was all it had: unbound, not reset.
    expect(settings.value.keybindings.macos.find).toEqual([]);
    expect(matchBinding(keyEvent("d", { metaKey: true }))).toBe("split-row");
    expect(document.body.textContent).not.toContain("Also bound");
    expect(rowOf("shortcut:find")?.textContent).toContain("Unbound");
  });

  it("Reassign on the other row hands the chord to that one instead", async () => {
    settings.value = FIND_ON_SPLIT;
    await open();
    await clickIn(rowOf("shortcut:find")?.querySelector("button[aria-label^='Reassign']"));
    expect(settings.value.keybindings.macos["split-row"]).toEqual([]);
    expect(matchBinding(keyEvent("d", { metaKey: true }))).toBe("find");
  });

  it("shows up as a Needs attention row that opens the offending row", async () => {
    settings.value = FIND_ON_SPLIT;
    commandScope.value = null;
    await open();
    const issue = document.querySelector<HTMLElement>('[id^="command-row-attention:"]');
    expect(issue?.textContent).toContain("⌘D is bound to Find… and Split Vertically");

    await clickIn(issue);
    expect(badge()).toBe("Shortcuts");
    // The user's newest choice leads the keymap, so that is the row it opens on.
    expect(activeRow()).toBe(rowOf("shortcut:find"));
    expect(scrolled).toContain(rowOf("shortcut:find"));
  });
});

describe("finding and listing shortcuts", () => {
  it("finds an action by its label as a live row", async () => {
    commandScope.value = null;
    await open();
    await typeInto(search(), "split vert");
    expect(rowLabels()[0]).toBe("Split Vertically");
    expect(recordButton("split-row", "Split Vertically")).not.toBeNull();
  });

  it("finds an action by its chord", async () => {
    commandScope.value = null;
    await open();
    await typeInto(search(), "cmd+d");
    expect(rowLabels()).toContain("Split Vertically");
  });

  it("lists a rebound action in the Changed list, with its area", async () => {
    settings.value = {
      ...DEFAULT_SETTINGS,
      keybindings: withOverride(NO_KEYBINDING_OVERRIDES, "macos", "find", [
        { key: "j", meta: true },
      ]),
    };
    commandScope.value = null;
    await open();
    const row = rowOf("changed:shortcut:find");
    expect(row?.textContent).toContain("Shortcuts");
    expect(caps("changed:shortcut:find")).toEqual(["⌘", "J"]);
  });

  it("is inert while the snapshot loads", async () => {
    settingsLoadState.value = { status: "loading" };
    await open();
    expect((recordButton("find", "Find…") as HTMLButtonElement).disabled).toBe(true);
  });
});
