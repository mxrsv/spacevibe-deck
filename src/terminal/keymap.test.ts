import { describe, expect, it } from "vitest";
import {
  DEFAULT_KEYMAP,
  isShortcutAction,
  matchBinding,
  selectTabIndex,
} from "./keymap";

function keyEvent(
  key: string,
  mods: Partial<
    Pick<KeyboardEvent, "metaKey" | "shiftKey" | "altKey" | "ctrlKey">
  > = {},
): KeyboardEvent {
  return {
    key,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    ...mods,
  } as KeyboardEvent;
}

describe("matchBinding", () => {
  it("keeps the existing pane bindings", () => {
    expect(matchBinding(keyEvent("d", { metaKey: true }))).toBe("split-row");
    expect(matchBinding(keyEvent("d", { metaKey: true, shiftKey: true }))).toBe(
      "split-column",
    );
    // Swapped to iTerm2 convention: Cmd+W closes the pane
    expect(matchBinding(keyEvent("w", { metaKey: true }))).toBe("close-pane");
    expect(matchBinding(keyEvent("]", { metaKey: true }))).toBe("focus-next");
    expect(matchBinding(keyEvent("[", { metaKey: true }))).toBe("focus-prev");
  });

  it("matches Cmd+E to toggle-expand", () => {
    expect(matchBinding(keyEvent("e", { metaKey: true }))).toBe(
      "toggle-expand",
    );
  });

  it("does not match E with other modifiers to toggle-expand", () => {
    expect(matchBinding(keyEvent("e"))).toBeNull();
    expect(
      matchBinding(keyEvent("e", { metaKey: true, shiftKey: true })),
    ).toBeNull();
    expect(matchBinding(keyEvent("e", { ctrlKey: true }))).toBeNull();
  });

  it("matches the new tab bindings", () => {
    expect(matchBinding(keyEvent("t", { metaKey: true }))).toBe("new-tab");
    expect(matchBinding(keyEvent("w", { metaKey: true, shiftKey: true }))).toBe(
      "close-tab",
    );
    // On a US layout Shift+] produces "}" and Shift+[ produces "{"
    expect(matchBinding(keyEvent("}", { metaKey: true, shiftKey: true }))).toBe(
      "next-tab",
    );
    expect(matchBinding(keyEvent("{", { metaKey: true, shiftKey: true }))).toBe(
      "prev-tab",
    );
  });

  it("matches Cmd+1..9 to select-tab actions", () => {
    expect(matchBinding(keyEvent("1", { metaKey: true }))).toBe("select-tab-1");
    expect(matchBinding(keyEvent("9", { metaKey: true }))).toBe("select-tab-9");
  });

  it("matches the zoom bindings", () => {
    expect(matchBinding(keyEvent("=", { metaKey: true }))).toBe("zoom-in");
    // Shift+= produces "+" on a US layout
    expect(matchBinding(keyEvent("+", { metaKey: true, shiftKey: true }))).toBe(
      "zoom-in",
    );
    expect(matchBinding(keyEvent("-", { metaKey: true }))).toBe("zoom-out");
    expect(matchBinding(keyEvent("0", { metaKey: true }))).toBe("zoom-reset");
  });

  it("matches Cmd+Shift+Enter to toggle-zoom-pane", () => {
    expect(
      matchBinding(keyEvent("Enter", { metaKey: true, shiftKey: true })),
    ).toBe("toggle-zoom-pane");
    expect(matchBinding(keyEvent("Enter", { metaKey: true }))).toBeNull();
    expect(matchBinding(keyEvent("Enter"))).toBeNull();
  });

  it("does not zoom without the meta modifier", () => {
    expect(matchBinding(keyEvent("="))).toBeNull();
    expect(matchBinding(keyEvent("-"))).toBeNull();
    expect(matchBinding(keyEvent("0"))).toBeNull();
  });

  it("returns null when modifiers do not match exactly", () => {
    expect(matchBinding(keyEvent("t"))).toBeNull();
    expect(
      matchBinding(keyEvent("d", { metaKey: true, ctrlKey: true })),
    ).toBeNull();
  });

  it("matches the iTerm2-parity batch bindings", () => {
    expect(matchBinding(keyEvent("f", { metaKey: true }))).toBe("find");
    expect(matchBinding(keyEvent("k", { metaKey: true }))).toBe("clear-buffer");
    expect(matchBinding(keyEvent("t", { metaKey: true, shiftKey: true }))).toBe(
      "reopen-tab",
    );
  });

  it("matches Cmd+Option+Arrows to directional focus", () => {
    const mods = { metaKey: true, altKey: true };
    expect(matchBinding(keyEvent("ArrowLeft", mods))).toBe("focus-left");
    expect(matchBinding(keyEvent("ArrowRight", mods))).toBe("focus-right");
    expect(matchBinding(keyEvent("ArrowUp", mods))).toBe("focus-up");
    expect(matchBinding(keyEvent("ArrowDown", mods))).toBe("focus-down");
  });

  it("does not match arrows without both Cmd and Option", () => {
    expect(matchBinding(keyEvent("ArrowLeft", { metaKey: true }))).toBeNull();
    expect(matchBinding(keyEvent("ArrowLeft", { altKey: true }))).toBeNull();
    expect(matchBinding(keyEvent("ArrowLeft"))).toBeNull();
  });

  it("matches Cmd+Shift+S as save-preset", () => {
    expect(matchBinding(keyEvent("s", { metaKey: true, shiftKey: true }))).toBe(
      "save-preset",
    );
  });

  it("matches Cmd+Shift+A as focus-next-attention", () => {
    expect(matchBinding(keyEvent("a", { metaKey: true, shiftKey: true }))).toBe(
      "focus-next-attention",
    );
  });

  it("does not collide with other Cmd/Cmd+Shift bindings on the A key", () => {
    expect(matchBinding(keyEvent("a"))).toBeNull();
    expect(matchBinding(keyEvent("a", { metaKey: true }))).toBeNull();
    expect(matchBinding(keyEvent("a", { shiftKey: true }))).toBeNull();
    expect(
      matchBinding(keyEvent("a", { metaKey: true, altKey: true })),
    ).toBeNull();
    // Cmd+Shift+A must not accidentally match any other action's binding.
    expect(matchBinding(keyEvent("s", { metaKey: true, shiftKey: true }))).toBe(
      "save-preset",
    );
    expect(matchBinding(keyEvent("w", { metaKey: true, shiftKey: true }))).toBe(
      "close-tab",
    );
  });
});

describe("selectTabIndex", () => {
  it("parses select-tab actions into a 0-based index", () => {
    expect(selectTabIndex("select-tab-1")).toBe(0);
    expect(selectTabIndex("select-tab-9")).toBe(8);
  });

  it("returns null for every other action", () => {
    expect(selectTabIndex("new-tab")).toBeNull();
    expect(selectTabIndex("split-row")).toBeNull();
  });
});

describe("isShortcutAction", () => {
  it("accepts every action the default keymap binds", () => {
    for (const binding of DEFAULT_KEYMAP) {
      expect(isShortcutAction(binding.action)).toBe(true);
    }
  });

  it("rejects an unbound name, a near miss and a non-string", () => {
    // The macOS menu sends its item id over IPC as a plain string; a typo in
    // menu.rs must be a no-op, never a cast into an action that half-matches.
    expect(isShortcutAction("split-diagonal")).toBe(false);
    expect(isShortcutAction("Split-Row")).toBe(false);
    expect(isShortcutAction("select-tab-99")).toBe(false);
    expect(isShortcutAction("")).toBe(false);
    expect(isShortcutAction(undefined)).toBe(false);
    expect(isShortcutAction(42)).toBe(false);
  });
});
