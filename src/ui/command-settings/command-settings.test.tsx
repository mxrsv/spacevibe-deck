// @vitest-environment jsdom
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The sections an area mounts pull in host-backed stores; stub them so the tree mounts in jsdom.
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

import { DEFAULT_SETTINGS } from "../../settings/settings-schema";
import { settings, settingsLoadState } from "../../settings/settings-store";
import { byRole, mount, press, settle, waitUntil } from "../controls/preset-test-kit";
import { CommandSettings } from "./command-settings";
import { commandQuery, commandScope } from "./command-settings-state";
import {
  activeRow,
  badge,
  chip,
  clickIn,
  controlOf,
  openSurface as open,
  resetCommandSettings,
  rowLabels,
  rowOf,
  search,
  typeInto,
} from "./command-settings-test-kit";

beforeEach(resetCommandSettings);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Command Settings frame", () => {
  it("puts focus in the search field and offers every area as a chip", async () => {
    await open();
    expect(document.activeElement).toBe(search());
    const chips = [
      ...document.querySelectorAll('[aria-label="Areas"] [data-slot="toggle-group-item"]'),
    ].map((item) => item.textContent);
    expect(chips).toEqual([
      "Appearance",
      "Browser",
      "Terminal",
      "Agents",
      "Links & editor",
      "Shortcuts",
      "Notifications",
      "About",
      "Privacy",
      "Reset",
    ]);
  });

  it("renders nothing while closed", async () => {
    const view = await mount(<CommandSettings open={false} onClose={vi.fn()} />);
    expect(view.host.innerHTML).toBe("");
  });

  it("lists what changed as live rows, and Enter goes into the control without changing it", async () => {
    settings.value = { ...DEFAULT_SETTINGS, scrollback: 1000 };
    await open();
    expect(rowLabels()).toEqual(["Scrollback"]);
    expect(activeRow()).toBe(rowOf("changed:setting:scrollback"));
    expect(activeRow()?.textContent).toContain("1k lines");
    expect(activeRow()?.textContent).toContain("Terminal");

    await press(search(), { key: "Enter" });

    // Enter moved focus into the row's menu; it did not open another area or touch the value.
    expect(document.activeElement).toBe(controlOf("changed:setting:scrollback", "[role=combobox]"));
    expect(badge()).toBeUndefined();
    expect(settings.value.scrollback).toBe(1000);
  });

  it("opens an area from its stand-in row and keeps typing in the field", async () => {
    await open();
    await typeInto(search(), "terminal");
    const entry = rowOf("area:terminal");
    entry?.focus();
    await clickIn(entry);
    expect(badge()).toBe("Terminal");
    // The row unmounted with the list; the search field took focus rather than the body.
    expect(document.activeElement).toBe(search());
  });

  it("closes when a press lands on the scrim, the pointer's way out of the modal", async () => {
    const { onClose } = await open();
    const scrim = (byRole("dialog") as HTMLElement).parentElement as HTMLElement;
    await act(async () => {
      scrim.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    });
    await settle();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("stays open for a press inside the panel, in a field or on a row", async () => {
    const { onClose } = await open();
    const panel = byRole("dialog") as HTMLElement;
    for (const target of [panel, search(), chip("Terminal")]) {
      await act(async () => {
        target.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
      });
    }
    await settle();
    expect(onClose).not.toHaveBeenCalled();
    expect(byRole("dialog")).not.toBeNull();
  });

  it("names the panel as a modal dialog", async () => {
    await open();
    const panel = byRole("dialog") as HTMLElement;
    expect(panel.getAttribute("aria-label")).toBe("Settings");
    expect(panel.getAttribute("aria-modal")).toBe("true");
    expect(panel.contains(search())).toBe(true);
  });

  it("narrows the list to what the text matches, grouped under its area", async () => {
    await open();
    await typeInto(search(), "scroll");
    const headings = [...document.querySelectorAll("h3")].map((heading) => heading.textContent);
    // The best hit's area leads; Shortcuts follows for its scrollback actions.
    expect(headings).toEqual(["Terminal", "Shortcuts"]);
    expect(rowLabels()[0]).toBe("Scrollback");
    expect(rowLabels()).not.toContain("Font size");

    await typeInto(search(), "zzzzzz");
    expect(document.body.textContent).toContain("Nothing matches");
    expect(rowLabels()).toEqual([]);
  });

  it("walks rows with the arrows, and Enter goes into the highlighted row's control", async () => {
    await open();
    await typeInto(search(), "font");
    expect(rowLabels().slice(0, 2)).toEqual(["Font", "Font size"]);
    expect(activeRow()).toBe(rowOf("setting:fontFamily"));

    await press(search(), { key: "ArrowDown" });
    expect(activeRow()).toBe(rowOf("setting:fontSize"));
    await press(search(), { key: "ArrowUp" });
    await press(search(), { key: "ArrowUp" });
    expect(activeRow()).toBe(rowOf("setting:fontFamily"));

    await press(search(), { key: "ArrowDown" });
    await press(search(), { key: "Enter" });
    expect(document.activeElement).toBe(controlOf("setting:fontSize", "input"));
    expect(settings.value.fontSize).toBe(DEFAULT_SETTINGS.fontSize);
    expect(commandQuery.value).toBe("font");
  });

  it("scopes to an area from its chip, lists its rows, and leaves with the badge button", async () => {
    await open();
    await clickIn(chip("Terminal"));
    expect(badge()).toBe("Terminal");
    expect(rowLabels()).toEqual(["Scrollback"]);

    await clickIn(document.querySelector<HTMLElement>('button[aria-label="Leave Terminal"]'));
    expect(badge()).toBeUndefined();
    expect(rowLabels()).toEqual([]);
  });

  it("mounts the legacy section of an area no row edits yet", async () => {
    await open();
    await clickIn(chip("Privacy"));
    expect(document.querySelector('section[aria-label="Privacy"]')).not.toBeNull();
    expect(rowLabels()).toEqual([]);
  });

  it("returns focus to where it was once it closes with nothing else holding it", async () => {
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();
    const view = await mount(<CommandSettings open onClose={vi.fn()} />);
    expect(document.activeElement).toBe(search());

    await view.update(<CommandSettings open={false} onClose={vi.fn()} />);
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });
});

describe("Command Settings keyboard", () => {
  it("Escape clears the query, then leaves the area, then closes", async () => {
    commandScope.value = "terminal";
    const { onClose } = await open();
    await typeInto(search(), "scroll");

    await press(search(), { key: "Escape" });
    expect(commandQuery.value).toBe("");
    expect(commandScope.value).toBe("terminal");
    expect(onClose).not.toHaveBeenCalled();

    await press(search(), { key: "Escape" });
    expect(commandScope.value).toBeNull();
    expect(onClose).not.toHaveBeenCalled();

    await press(search(), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Backspace on an empty field leaves the area", async () => {
    commandScope.value = "terminal";
    await open();
    await press(search(), { key: "Backspace" });
    expect(commandScope.value).toBeNull();
  });

  it("leaves Escape to a terminal that owns focus", async () => {
    const { onClose } = await open();
    const term = document.createElement("div");
    term.className = "xterm";
    const area = document.createElement("textarea");
    term.appendChild(area);
    document.body.appendChild(term);
    area.focus();

    await press(area, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    term.remove();
  });

  it("leaves Escape to an open popup", async () => {
    commandScope.value = "terminal";
    const { onClose } = await open();
    const popup = document.createElement("div");
    popup.setAttribute("data-slot", "select-content");
    document.body.appendChild(popup);

    await press(search(), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(commandScope.value).toBe("terminal");
    popup.remove();
  });

  it("keeps an uncommitted draft's Escape for the field, and only then lets Escape through", async () => {
    commandScope.value = "browser";
    const { onClose } = await open();
    const field = controlOf("setting:browserHomeUrl", "input") as HTMLInputElement;
    field.focus();
    await typeInto(field, "http://localhost:9999");

    // The draft is unsaved: Escape reverts it and goes no further.
    await press(field, { key: "Escape" });
    expect(field.value).toBe(DEFAULT_SETTINGS.browserHomeUrl);
    expect(commandScope.value).toBe("browser");
    expect(onClose).not.toHaveBeenCalled();

    // Clean now: Escape hands focus back to the search field rather than closing.
    await press(field, { key: "Escape" });
    expect(document.activeElement).toBe(search());
    expect(commandScope.value).toBe("browser");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("commits a typed value when Escape moves focus out of its field", async () => {
    commandScope.value = "browser";
    await open();
    const field = controlOf("setting:browserHomeUrl", "input") as HTMLInputElement;
    field.focus();
    await typeInto(field, "http://localhost:4000");
    // Enter commits; the draft is now the saved value, so Escape is no longer claimed.
    await press(field, { key: "Enter" });
    await press(field, { key: "Escape" });
    expect(settings.value.browserHomeUrl).toBe("http://localhost:4000");
  });

  it("brings Escape back from a live row's control to the search field, nothing else", async () => {
    commandScope.value = "terminal";
    const { onClose } = await open();
    await press(search(), { key: "Enter" });
    const trigger = controlOf("setting:scrollback", "[role=combobox]");
    expect(document.activeElement).toBe(trigger);

    await press(trigger, { key: "Escape" });
    expect(document.activeElement).toBe(search());
    expect(commandScope.value).toBe("terminal");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("leaves Escape and Tab to a menu that is open", async () => {
    commandScope.value = "terminal";
    const { onClose } = await open();
    await clickIn(controlOf("setting:scrollback", "[role=combobox]"));
    const list = byRole("listbox") as HTMLElement;
    expect(list).not.toBeNull();

    const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    list.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(false);

    await press(list, { key: "Escape" });
    await waitUntil(
      () => byRole("listbox") === null || byRole("listbox")?.closest("[hidden]") !== null,
    );
    expect(commandScope.value).toBe("terminal");
    expect(commandQuery.value).toBe("");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps Tab inside the surface, wrapping at both ends and pulling stray focus back in", async () => {
    await open();
    const root = document.querySelector('[role="dialog"]') as HTMLElement;
    const stops = [...root.querySelectorAll<HTMLElement>("input, button")].filter(
      (item) => item.tabIndex >= 0,
    );
    const first = stops[0];
    const last = stops[stops.length - 1];

    last.focus();
    await press(last, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    first.focus();
    await press(first, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);

    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();
    await press(outside, { key: "Tab" });
    expect(root.contains(document.activeElement)).toBe(true);
    outside.remove();
  });
});

describe("Command Settings loading snapshot", () => {
  it("makes the list inert while the snapshot loads, but keeps the field and chips usable", async () => {
    settingsLoadState.value = { status: "loading" };
    commandScope.value = "terminal";
    await open();
    const list = document.querySelector('[aria-label="Results"] fieldset') as HTMLFieldSetElement;
    expect(list.disabled).toBe(true);
    expect(search().disabled).toBe(false);
    expect(chip("Browser").hasAttribute("disabled")).toBe(false);
    expect(document.querySelector('[aria-label="Results"]')?.getAttribute("aria-busy")).toBe(
      "true",
    );
  });

  it("shows a failed load with a retry", async () => {
    settingsLoadState.value = { status: "error", message: "Couldn't load settings." };
    await open();
    const alert = document.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Couldn't load settings.");
    expect(alert?.querySelector("button")?.textContent).toMatch(/retry/i);
  });
});
