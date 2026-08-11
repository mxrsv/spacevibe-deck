/**
 * Main→renderer WIRE SHAPES.
 *
 * `scripts/electron-ipc-contract.test.ts` only checks renderer→main invokes, so
 * every event payload was unguarded — and that is where the expensive bugs
 * were: `menu:action` shipped an object where the renderer's guards compare
 * strings, `menu:move-pane-to-window` used `label` where the only boundary
 * check reads `targetLabel`, `window_boot_mode` used `mode`/`restore` where the
 * renderer reads `kind`/`normal`, and `desktop_environment` returned `home`
 * where `platform.ts` demands `homeDir`. Each one silently disabled a whole
 * feature with a green suite.
 *
 * These assert the shapes directly against the renderer's own validators, so a
 * future rename fails here instead of in the app.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { WindowRegistry } from "./window-lifecycle";
import { bootModeOrNormal, moveToWindowTarget } from "../src/terminal/transfer-client";
import { isUpdateMenuAction } from "../src/updater/update-menu-actions";
import { parseDesktopEnvironment } from "../src/lib/platform";

const MAIN = readFileSync("electron/main.ts", "utf8");
const MENU = readFileSync("electron/menu.ts", "utf8");

describe("window_boot_mode", () => {
  const registry = new WindowRegistry();

  it("produces a shape the renderer accepts", () => {
    registry.reserveAdoption("deck-1", "xfer-7");

    // `mode: "restore"` fell through to normal, so a detached window booted to
    // the Open Board and its pane stayed stranded until the transfer timed out.
    expect(bootModeOrNormal(registry.bootMode("deck-1"))).toEqual({
      kind: "adopt",
      token: "xfer-7",
    });
    expect(bootModeOrNormal(registry.bootMode("deck-1"))).toEqual({
      kind: "normal",
    });
  });
});

describe("menu:move-pane-to-window", () => {
  it("emits the key the renderer's only boundary check reads", () => {
    // `moveToWindowTarget` returns null for anything but `targetLabel`, and it
    // is the whole guard on where a running agent's pane ends up.
    const match = /menuMovePaneToWindow, \{\s*([a-zA-Z]+):/.exec(MENU);

    expect(match?.[1]).toBe("targetLabel");
    expect(moveToWindowTarget({ targetLabel: "deck-2" })).toBe("deck-2");
    expect(moveToWindowTarget({ label: "deck-2" })).toBe(null);
  });
});

describe("menu:action", () => {
  it("emits a bare string, not an object", () => {
    // The renderer declares `listen<string>` and both guards are string
    // comparisons; an object matched neither and every menu item did nothing.
    expect(MENU).toContain("EVENTS.menuAction, action.id");
    expect(isUpdateMenuAction("check-for-updates")).toBe(true);
    expect(isUpdateMenuAction({ id: "check-for-updates" })).toBe(false);
  });
});

describe("desktop_environment", () => {
  it("returns a shape the renderer validator accepts", () => {
    // Getting this wrong disabled EVERY keyboard shortcut: the validator threw,
    // the caller swallowed it, and the app fell back to platform "unsupported"
    // where `hasPrimaryModifier` is false for every event.
    expect(MAIN).toContain('homeDir: app.getPath("home")');
    expect(() =>
      parseDesktopEnvironment({ platform: "macos", homeDir: "/Users/dev" }),
    ).not.toThrow();
    // The shape that shipped: `home` instead of `homeDir`.
    expect(() =>
      parseDesktopEnvironment({ platform: "macos", home: "/Users/dev" }),
    ).toThrow();
  });
});

describe("navigation is blocked", () => {
  it("installs will-navigate and denies window.open", () => {
    // The preload re-injects the full host bridge into any document the window
    // navigates to, and a dropped .html file is a real way to get there.
    expect(MAIN).toContain('webContents.on("will-navigate"');
    expect(MAIN).toContain("setWindowOpenHandler");
  });
});

describe("shell_open_url", () => {
  it("keeps a scheme allowlist, as the Tauri capability did", () => {
    const allowlist = /OPENABLE_SCHEMES = new Set\(\[([^\]]*)\]\)/.exec(MAIN);

    expect(allowlist).not.toBe(null);
    // `file:` must NOT be openable — an OSC 8 hyperlink carrying
    // `file:///Applications/…` was one renderer bug from launching it.
    expect(allowlist?.[1]).not.toContain("file:");
    expect(allowlist?.[1]).toContain("https:");
  });
});

describe("store file names", () => {
  it("are allowlisted so `..` cannot escape the app directory", () => {
    expect(MAIN).toContain("assertStoreFile");
    expect(MAIN).toContain("STORE_FILES");
  });
});
