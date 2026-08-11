/**
 * The native menu's accelerators, which are the half of a rebind that cannot
 * be seen from the renderer.
 *
 * Cocoa consumes an accelerator before the webview receives the keydown. So a
 * menu still advertising the shipped chord after a rebind does not merely look
 * stale — it runs the OLD action, and the new binding never fires. The renderer
 * tests cannot observe that at all, which is why it is asserted here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MenuItemConstructorOptions } from "electron";

const built: MenuItemConstructorOptions[][] = [];

vi.mock("electron", () => ({
  app: { getName: () => "Deck" },
  Menu: {
    buildFromTemplate: (template: MenuItemConstructorOptions[]) => {
      built.push(template);
      return template;
    },
    setApplicationMenu: () => {},
  },
}));

import { buildMenu } from "./menu";
import { WindowRegistry } from "./window-lifecycle";
import { resolveKeymap, withOverride, NO_KEYBINDING_OVERRIDES } from "../src/lib/keybindings";

const realPlatform = process.platform;

function items(template: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  return template.flatMap((entry) =>
    Array.isArray(entry.submenu) ? entry.submenu : [],
  );
}

function accelerator(
  template: MenuItemConstructorOptions[],
  id: string,
): string | undefined {
  return items(template).find((item) => item.id === id)?.accelerator;
}

function render(
  keymap?: ReturnType<typeof resolveKeymap>,
  suspendAccelerators?: boolean,
): MenuItemConstructorOptions[] {
  built.length = 0;
  buildMenu({
    registry: new WindowRegistry(),
    emitTo: () => {},
    focused: () => null,
    keymap,
    suspendAccelerators,
  });
  return built[0] ?? [];
}

describe("menu accelerators", () => {
  beforeEach(() => {
    // The menu is macOS-only; without this every assertion below would pass
    // vacuously on a Linux CI runner.
    Object.defineProperty(process, "platform", { value: "darwin" });
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: realPlatform });
  });

  it("advertises the shipped chord when nothing is overridden", () => {
    expect(accelerator(render(), "split-row")).toBe("CmdOrCtrl+D");
    expect(accelerator(render(), "toggle-settings")).toBe("CmdOrCtrl+,");
  });

  it("follows a rebind, so Cocoa stops eating the old chord", () => {
    const keymap = resolveKeymap(
      "macos",
      withOverride(NO_KEYBINDING_OVERRIDES, "macos", "split-row", [
        { key: "j", meta: true, alt: true },
      ]),
    );
    expect(accelerator(render(keymap), "split-row")).toBe("CmdOrCtrl+Alt+J");
  });

  it("drops the accelerator of an action the user unbound", () => {
    const keymap = resolveKeymap(
      "macos",
      withOverride(NO_KEYBINDING_OVERRIDES, "macos", "clear-buffer", []),
    );
    expect(accelerator(render(keymap), "clear-buffer")).toBeUndefined();
    // The item itself stays — it is still reachable with the mouse.
    expect(items(render(keymap)).some((item) => item.id === "clear-buffer")).toBe(
      true,
    );
  });

  it("strips every accelerator while a chord is being recorded", () => {
    // Otherwise pressing ⌘W to rebind `close-pane` closes the pane instead:
    // the OS runs the menu item and the webview never sees the keydown.
    const suspended = items(render(undefined, true));
    expect(suspended.length).toBeGreaterThan(5);
    expect(suspended.filter((item) => item.accelerator !== undefined)).toEqual(
      [],
    );
    // …and comes back afterwards.
    expect(accelerator(render(undefined, false), "split-row")).toBe(
      "CmdOrCtrl+D",
    );
  });

  it("keeps the labels while accelerators are suspended", () => {
    const suspended = items(render(undefined, true));
    expect(suspended.find((item) => item.id === "split-row")?.label).toBe(
      "Split Vertically",
    );
  });
});
