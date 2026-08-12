/** Translated from `src-tauri/src/window_lifecycle.rs`. */
import { beforeEach, describe, expect, it } from "vitest";
import { WindowRegistry } from "./window-lifecycle";

let registry: WindowRegistry;

beforeEach(() => {
  registry = new WindowRegistry();
});

describe("label allocation", () => {
  it("never reuses a label within a process run", () => {
    // The coordinator remembers dead labels to decide whether a pane may be
    // handed back; a reused label would resurrect a window that is gone.
    const first = registry.allocateLabel();
    registry.forgetWindow(first);
    const second = registry.allocateLabel();

    expect(second).not.toBe(first);
  });

  it("starts at deck-1", () => {
    // The label is menu item text, so an off-by-one was user-visible.
    expect(registry.allocateLabel()).toBe("deck-1");
  });

  it("allocates deck-N labels", () => {
    expect(registry.allocateLabel()).toMatch(/^deck-\d+$/);
  });
});

describe("focus order", () => {
  it("lists most-recently-focused first", () => {
    registry.recordFocus("main");
    registry.recordFocus("deck-2");
    registry.recordFocus("deck-3");

    expect(registry.order()).toEqual(["deck-3", "deck-2", "main"]);
  });

  it("moves a refocused window to the front without duplicating it", () => {
    registry.recordFocus("main");
    registry.recordFocus("deck-2");
    registry.recordFocus("main");

    expect(registry.order()).toEqual(["main", "deck-2"]);
  });

  it("excludes the asking window, which is what the move-pane submenu needs", () => {
    registry.recordFocus("main");
    registry.recordFocus("deck-2");

    expect(registry.order("deck-2")).toEqual(["main"]);
  });

  it("drops a forgotten window", () => {
    registry.recordFocus("main");
    registry.recordFocus("deck-2");

    registry.forgetWindow("deck-2");

    expect(registry.order()).toEqual(["main"]);
  });
});

describe("boot mode", () => {
  it("restores by default", () => {
    expect(registry.bootMode("main")).toEqual({ kind: "normal" });
  });

  it("adopts once for a reserved window, then restores", () => {
    // Consumed once: a reload must not re-adopt a pane already taken.
    registry.reserveAdoption("deck-2", "xfer-1");

    expect(registry.bootMode("deck-2")).toEqual({
      kind: "adopt",
      token: "xfer-1",
    });
    expect(registry.bootMode("deck-2")).toEqual({ kind: "normal" });
  });

  it("drops a pending adoption when the window is forgotten", () => {
    registry.reserveAdoption("deck-2", "xfer-1");

    registry.forgetWindow("deck-2");

    expect(registry.bootMode("deck-2")).toEqual({ kind: "normal" });
  });
});
