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
    code: "",
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    ...mods,
  } as KeyboardEvent;
}

/**
 * A keydown whose `code` (physical key position) is decoupled from `key`
 * (the character the active layout actually produces) — simulates a non-US
 * layout or an IME rewriting `key`, e.g. AZERTY's BracketRight position
 * producing "$" instead of "]".
 */
function codeEvent(
  code: string,
  key: string,
  mods: Partial<
    Pick<KeyboardEvent, "metaKey" | "shiftKey" | "altKey" | "ctrlKey">
  > = {},
): KeyboardEvent {
  return {
    key,
    code,
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
    // focus-next/prev bind by physical key position (event.code), not the
    // produced character — see the dedicated non-US-layout test below.
    expect(
      matchBinding(codeEvent("BracketRight", "]", { metaKey: true })),
    ).toBe("focus-next");
    expect(matchBinding(codeEvent("BracketLeft", "[", { metaKey: true }))).toBe(
      "focus-prev",
    );
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
    // next-tab/prev-tab bind by physical key position (event.code): on a US
    // layout Shift+BracketRight/BracketLeft happen to produce "}"/"{", but
    // the binding itself does not depend on that — see the dedicated
    // non-US-layout test below.
    expect(
      matchBinding(
        codeEvent("BracketRight", "}", { metaKey: true, shiftKey: true }),
      ),
    ).toBe("next-tab");
    expect(
      matchBinding(
        codeEvent("BracketLeft", "{", { metaKey: true, shiftKey: true }),
      ),
    ).toBe("prev-tab");
  });

  it("matches focus-next/prev and next/prev-tab by physical key position, not the layout-produced character (Lỗi 1 regression)", () => {
    // AZERTY: the key in the BracketRight position produces "$" unshifted
    // and "£" shifted; the key in the BracketLeft position produces "*"
    // unshifted and "¨" shifted — never "]"/"}" or "["/"{". A key-based
    // binding would silently lose these shortcuts on this layout.
    expect(
      matchBinding(codeEvent("BracketRight", "$", { metaKey: true })),
    ).toBe("focus-next");
    expect(matchBinding(codeEvent("BracketLeft", "*", { metaKey: true }))).toBe(
      "focus-prev",
    );
    expect(
      matchBinding(
        codeEvent("BracketRight", "£", { metaKey: true, shiftKey: true }),
      ),
    ).toBe("next-tab");
    expect(
      matchBinding(
        codeEvent("BracketLeft", "¨", { metaKey: true, shiftKey: true }),
      ),
    ).toBe("prev-tab");
  });

  it("matches Cmd+1..8 to select-tab actions, and Cmd+9 to select-last-tab (macOS 'last tab' convention, not tab index 9)", () => {
    // Digit1..Digit9 bind by physical key position (event.code), not the
    // produced character (F-C1, 2026-07-27 code review) — on a US layout
    // that position happens to produce "1".."9" unshifted, but the binding
    // itself does not depend on that. See the dedicated AZERTY regression
    // test below.
    expect(matchBinding(codeEvent("Digit1", "1", { metaKey: true }))).toBe(
      "select-tab-1",
    );
    expect(matchBinding(codeEvent("Digit8", "8", { metaKey: true }))).toBe(
      "select-tab-8",
    );
    expect(matchBinding(codeEvent("Digit9", "9", { metaKey: true }))).toBe(
      "select-last-tab",
    );
  });

  // F-C1 (2026-07-27 code review): select-tab-N/select-last-tab have no menu
  // item, so per the repo's key-vs-code rule they should bind by physical
  // position — but they were still key-based, so on AZERTY (Digit1..Digit9
  // unshifted produce "&", "é", '"', "'", "(", "-", "è", "_", "ç" — never
  // "1".."9", which need Shift on that layout) Cmd+1..Cmd+9 matched nothing
  // at all: switching tabs by number was completely dead.
  it("matches Cmd+1..9 by physical digit-key position on AZERTY, where Digit1..Digit9 unshifted never produce '1'..'9' (F-C1 regression)", () => {
    expect(matchBinding(codeEvent("Digit1", "&", { metaKey: true }))).toBe(
      "select-tab-1",
    );
    expect(matchBinding(codeEvent("Digit2", "é", { metaKey: true }))).toBe(
      "select-tab-2",
    );
    expect(matchBinding(codeEvent("Digit8", "_", { metaKey: true }))).toBe(
      "select-tab-8",
    );
    expect(matchBinding(codeEvent("Digit9", "ç", { metaKey: true }))).toBe(
      "select-last-tab",
    );
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

  it("matches Cmd+G as find-next and Cmd+Shift+G as find-previous", () => {
    expect(matchBinding(keyEvent("g", { metaKey: true }))).toBe("find-next");
    expect(matchBinding(keyEvent("g", { metaKey: true, shiftKey: true }))).toBe(
      "find-previous",
    );
  });

  it("does not match G without the meta modifier", () => {
    expect(matchBinding(keyEvent("g"))).toBeNull();
    expect(matchBinding(keyEvent("g", { shiftKey: true }))).toBeNull();
  });

  // menu.rs's "New Layout Preset…" item has had this accelerator since
  // 09f5c4d, before the webview keymap knew about it — Task 4
  // (docs/plans/2026-07-27-action-registry.md) unifies new-preset into the
  // same action:/runAction path as every other action, which means it now
  // needs a real DEFAULT_KEYMAP binding too.
  it("matches Cmd+Shift+N as new-preset", () => {
    expect(matchBinding(keyEvent("n", { metaKey: true, shiftKey: true }))).toBe(
      "new-preset",
    );
  });

  it("matches Cmd+, as toggle-settings", () => {
    expect(matchBinding(keyEvent(",", { metaKey: true }))).toBe(
      "toggle-settings",
    );
  });

  it("does not match comma without the meta modifier", () => {
    expect(matchBinding(keyEvent(","))).toBeNull();
    expect(matchBinding(keyEvent(",", { shiftKey: true }))).toBeNull();
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
    expect(selectTabIndex("select-tab-8")).toBe(7);
  });

  it("returns null for every other action, including select-last-tab", () => {
    expect(selectTabIndex("new-tab")).toBeNull();
    expect(selectTabIndex("split-row")).toBeNull();
    // select-last-tab (⌘9) has no fixed index — its concrete index is
    // resolved against the live tab count in tab-manager.ts, not here.
    expect(selectTabIndex("select-last-tab")).toBeNull();
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
    // ⌘9 is select-last-tab now, not tab index 9 — select-tab-9 is no
    // longer bound (TAB_SELECT_BINDINGS only covers 1..8).
    expect(isShortcutAction("select-tab-9")).toBe(false);
    expect(isShortcutAction("select-last-tab")).toBe(true);
    expect(isShortcutAction("")).toBe(false);
    expect(isShortcutAction(undefined)).toBe(false);
    expect(isShortcutAction(42)).toBe(false);
  });
});
