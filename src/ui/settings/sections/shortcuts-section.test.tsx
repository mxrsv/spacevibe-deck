// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Same stub the other section tests use: the store is host-backed, and the
// component tree has to mount without a bridge.
vi.mock("../../../host/store-host", () => ({
  Store: {
    load: vi.fn(async () => ({
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => {}),
      save: vi.fn(async () => {}),
    })),
  },
}));

const suspendMenuAccelerators = vi.fn(async (_suspended: boolean) => {});
vi.mock("../../../host/menu-host", () => ({
  suspendMenuAccelerators: (suspended: boolean) =>
    suspendMenuAccelerators(suspended),
}));

import { ShortcutsSection } from "./shortcuts-section";
import { settings } from "../../../settings/settings-store";
import { DEFAULT_SETTINGS } from "../../../settings/settings-schema";
import { shortcutCaptureActive } from "../../../chrome/events";
import {
  NO_KEYBINDING_OVERRIDES,
  withOverride,
} from "../../../lib/keybindings";
import { matchBinding } from "../../../terminal/keymap";
import { resetActiveKeymapCache } from "../../../terminal/active-keymap";
import { ACTION_REGISTRY } from "../../../terminal/action-registry";
import { NOT_REBINDABLE } from "../shortcut-groups";

function keyEvent(
  key: string,
  mods: Partial<
    Pick<KeyboardEvent, "metaKey" | "shiftKey" | "altKey" | "ctrlKey">
  > = {},
): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...mods,
  });
}

describe("ShortcutsSection", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    settings.value = DEFAULT_SETTINGS;
    resetActiveKeymapCache();
    suspendMenuAccelerators.mockClear();
    shortcutCaptureActive.value = false;
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    act(() => {
      render(null, host);
    });
    host.remove();
    shortcutCaptureActive.value = false;
  });

  const mount = (): void => {
    act(() => {
      render(<ShortcutsSection />, host);
    });
  };

  const rowFor = (label: string): Element => {
    const row = [...host.querySelectorAll(".cfg-row--shortcut")].find(
      (candidate) =>
        candidate.querySelector(".cfg-row__label")?.textContent === label,
    );
    if (row === undefined) {
      throw new Error(`No shortcut row labelled ${label}`);
    }
    return row;
  };

  const captureButton = (label: string): HTMLButtonElement => {
    const button = rowFor(label).querySelector<HTMLButtonElement>(".cfg-chord");
    if (button === null) {
      throw new Error(`Row ${label} has no capture pill`);
    }
    return button;
  };

  it("gives every rebindable registry action a row", () => {
    mount();
    const labels = new Set(
      [...host.querySelectorAll(".cfg-row--shortcut .cfg-row__label")].map(
        (node) => node.textContent,
      ),
    );
    for (const action of ACTION_REGISTRY) {
      // `NOT_REBINDABLE` actions have no keyboard dispatch path at all, so a
      // pill for them would sit over a permanent no-op — see shortcut-groups.ts.
      if (NOT_REBINDABLE.has(action.id)) {
        expect(labels.has(action.label), action.id).toBe(false);
        continue;
      }
      expect(labels.has(action.label), action.id).toBe(true);
    }
  });

  it("shows both platforms' chords, editing only the running one", () => {
    mount();
    const row = rowFor("Split Vertically");
    // The dev-preview platform is `unsupported`, which resolves to the macOS
    // keymap — so macOS is the editable side here.
    expect(row.querySelector(".cfg-chord")?.textContent).toBe("⌘D");
    expect(row.querySelector(".cfg-readout")?.textContent).toBe(
      "Ctrl+Shift+D",
    );
    // Exactly one editable chord per row (DL-17.3).
    expect(row.querySelectorAll(".cfg-chord")).toHaveLength(1);
    expect(row.querySelectorAll(".cfg-readout")).toHaveLength(1);
  });

  it("reads `unbound` where the platform ships no chord", () => {
    mount();
    // `copy-selection` is bound on Windows only — macOS leaves ⌘C to the Cocoa
    // Copy role. That is a normal state, not an error (DL-17.4).
    const row = rowFor("Copy Selection");
    expect(row.querySelector(".cfg-chord")?.textContent).toBe("unbound");
    expect(row.querySelector(".cfg-readout")?.textContent).toBe("Ctrl+Shift+C");
  });

  it("records a pressed chord and makes it the one that fires", () => {
    mount();
    act(() => {
      captureButton("Find…").click();
    });
    expect(captureButton("Find…").textContent).toBe("press keys…");

    act(() => {
      window.dispatchEvent(keyEvent("j", { metaKey: true, altKey: true }));
    });

    expect(settings.value.keybindings.macos.find).toEqual([
      { key: "j", meta: true, alt: true, shift: false, ctrl: false },
    ]);
    // `matchBinding` with NO keymap argument — the live path. Resolving a
    // keymap here and passing it in only re-tested `resolveKeymap`, and would
    // have stayed green with an `activeKeymap()` cache that never invalidated.
    expect(matchBinding(keyEvent("j", { metaKey: true, altKey: true }))).toBe(
      "find",
    );
    // …and the chord it replaced no longer fires it.
    expect(matchBinding(keyEvent("f", { metaKey: true }))).toBeNull();
  });

  it("gates the app's own shortcuts while recording, and lets go after", () => {
    // Without this, pressing ⌘W to rebind `close-pane` closes the pane.
    mount();
    act(() => {
      captureButton("Close Pane").click();
    });
    expect(shortcutCaptureActive.value).toBe(true);
    expect(suspendMenuAccelerators).toHaveBeenCalledWith(true);

    act(() => {
      window.dispatchEvent(keyEvent("w", { metaKey: true, altKey: true }));
    });
    expect(shortcutCaptureActive.value).toBe(false);
    expect(suspendMenuAccelerators).toHaveBeenLastCalledWith(false);
  });

  it("releases the gate when the recording is abandoned, not just completed", () => {
    // A stuck flag would leave every shortcut in the app dead.
    mount();
    act(() => {
      captureButton("Find…").click();
    });
    act(() => {
      window.dispatchEvent(keyEvent("Escape"));
    });
    expect(shortcutCaptureActive.value).toBe(false);
    expect(settings.value.keybindings.macos.find).toBeUndefined();

    act(() => {
      captureButton("Find…").click();
    });
    act(() => {
      render(null, host);
    });
    expect(shortcutCaptureActive.value).toBe(false);
  });

  it("keeps listening while only modifiers are down", () => {
    mount();
    act(() => {
      captureButton("Find…").click();
    });
    act(() => {
      window.dispatchEvent(keyEvent("Meta", { metaKey: true }));
    });
    expect(shortcutCaptureActive.value).toBe(true);
    expect(settings.value.keybindings.macos.find).toBeUndefined();
  });

  it("asks for a real modifier instead of binding a bare letter", () => {
    mount();
    act(() => {
      captureButton("Find…").click();
    });
    act(() => {
      window.dispatchEvent(keyEvent("a"));
    });
    expect(captureButton("Find…").textContent).toBe("add ⌘, ⌃ or ⌥");
    expect(settings.value.keybindings.macos.find).toBeUndefined();
    expect(shortcutCaptureActive.value).toBe(true);
  });

  it("unbinds on bare Backspace", () => {
    mount();
    act(() => {
      captureButton("Find…").click();
    });
    act(() => {
      window.dispatchEvent(keyEvent("Backspace"));
    });
    expect(settings.value.keybindings.macos.find).toEqual([]);
    expect(captureButton("Find…").textContent).toBe("unbound");
  });

  it("offers reset only on an overridden row, and restores the default", () => {
    settings.value = {
      ...DEFAULT_SETTINGS,
      keybindings: withOverride(NO_KEYBINDING_OVERRIDES, "macos", "find", [
        { key: "j", meta: true },
      ]),
    };
    mount();
    expect(rowFor("Split Vertically").querySelector(".cfg-clear")).toBeNull();

    const reset = rowFor("Find…").querySelector<HTMLButtonElement>(".cfg-clear");
    expect(reset).not.toBeNull();
    act(() => {
      reset?.click();
    });
    // Cleared, not emptied: "reset to default" and "unbind" are different
    // outcomes and the row must not confuse them.
    expect(settings.value.keybindings.macos.find).toBeUndefined();
    expect(captureButton("Find…").textContent).toBe("⌘F");
  });

  it("names both sides of a chord collision", () => {
    settings.value = {
      ...DEFAULT_SETTINGS,
      keybindings: withOverride(NO_KEYBINDING_OVERRIDES, "macos", "find", [
        { key: "d", meta: true },
      ]),
    };
    mount();
    expect(
      rowFor("Find…").querySelector(".cfg-row__desc--warn")?.textContent,
    ).toBe("also bound to Split Vertically");
    // Reported on the row that did not change, too — the user arriving later
    // cannot tell which of the two was the newer edit.
    expect(
      rowFor("Split Vertically").querySelector(".cfg-row__desc--warn")
        ?.textContent,
    ).toBe("also bound to Find…");
  });

  it("reports no collision on a clean keymap", () => {
    mount();
    expect(host.querySelectorAll(".cfg-row__desc--warn")).toHaveLength(0);
  });
});
