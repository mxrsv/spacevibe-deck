import { describe, expect, it } from "vitest";
import {
  MACOS_KEYMAP,
  WINDOWS_KEYMAP,
  ACTION_REGISTRY,
} from "../terminal/action-registry";
import {
  MAX_CHORDS_PER_ACTION,
  NO_KEYBINDING_OVERRIDES,
  chordConflicts,
  chordId,
  chordOf,
  chordsForAction,
  isChord,
  isOverridden,
  keymapPlatform,
  resolveKeymap,
  sameChord,
  validateKeybindings,
  withOverride,
  type Chord,
} from "./keybindings";
import { matchBinding } from "../terminal/keymap";

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

describe("keymapPlatform", () => {
  it("routes anything that is not windows to the macOS bucket", () => {
    expect(keymapPlatform("windows")).toBe("windows");
    expect(keymapPlatform("macos")).toBe("macos");
    // The browser-only dev preview. `keymapForPlatform` has always resolved it
    // this way, and an override map with no bucket for it would silently drop
    // every rebind made there.
    expect(keymapPlatform("unsupported")).toBe("macos");
  });
});

describe("isChord", () => {
  it("accepts a character chord and a code chord", () => {
    expect(isChord({ key: "d", meta: true })).toBe(true);
    expect(isChord({ code: "BracketRight", meta: true })).toBe(true);
  });

  it("rejects a chord carrying both key and code", () => {
    // It would match through `matchBinding`'s `"code" in binding` branch while
    // reading as a character binding everywhere else.
    expect(isChord({ key: "d", code: "KeyD", meta: true })).toBe(false);
  });

  it("rejects a chord carrying neither, and non-boolean modifiers", () => {
    expect(isChord({ meta: true })).toBe(false);
    expect(isChord({ key: "" })).toBe(false);
    expect(isChord({ key: "d", meta: "yes" })).toBe(false);
    expect(isChord(null)).toBe(false);
    expect(isChord("⌘D")).toBe(false);
  });
});

describe("chordId", () => {
  it("relates a code chord to the character a US layout produces for it", () => {
    // The collision a structural compare misses: `focus-next` ships as
    // `{ code: "BracketRight" }` and a user capturing the same physical key
    // stores `{ key: "]" }`.
    expect(chordId({ code: "BracketRight", meta: true })).toBe(
      chordId({ key: "]", meta: true }),
    );
    expect(chordId({ code: "Digit1", meta: true })).toBe(
      chordId({ key: "1", meta: true }),
    );
  });

  it("separates chords that differ only by a modifier", () => {
    expect(sameChord({ key: "d", meta: true }, { key: "d", meta: true })).toBe(
      true,
    );
    expect(
      sameChord({ key: "d", meta: true }, { key: "d", meta: true, shift: true }),
    ).toBe(false);
  });

  it("treats an absent modifier and an explicit false as the same chord", () => {
    // `captureChord` writes every modifier explicitly; the shipped keymaps omit
    // the false ones. Both spellings have to collide, or a rebind to a chord
    // that is already taken would look free.
    expect(
      sameChord(
        { key: "d", meta: true },
        { key: "d", meta: true, shift: false, alt: false, ctrl: false },
      ),
    ).toBe(true);
  });
});

describe("resolveKeymap", () => {
  it("returns the shipped keymap when nothing is overridden", () => {
    expect(resolveKeymap("macos", NO_KEYBINDING_OVERRIDES)).toBe(MACOS_KEYMAP);
    expect(resolveKeymap("windows", undefined)).toBe(WINDOWS_KEYMAP);
  });

  it("replaces every default chord of an overridden action", () => {
    const overrides = withOverride(
      NO_KEYBINDING_OVERRIDES,
      "windows",
      "paste",
      [{ key: "v", alt: true }],
    );
    const keymap = resolveKeymap("windows", overrides);
    // Windows ships `paste` three times (Ctrl+V, Ctrl+Shift+V, Shift+Insert).
    // An override replaces the whole set rather than adding a fourth.
    expect(chordsForAction(keymap, "paste")).toEqual([{ key: "v", alt: true }]);
  });

  it("puts the user's chord ahead of a default that still holds it", () => {
    // matchBinding returns the FIRST match, so ordering decides a collision.
    // The chord the user just chose has to be the one that fires, or the
    // rebind looks accepted in settings and does nothing at the keyboard.
    const overrides = withOverride(NO_KEYBINDING_OVERRIDES, "macos", "find", [
      { key: "d", meta: true },
    ]);
    const keymap = resolveKeymap("macos", overrides);
    expect(matchBinding(keyEvent("d", { metaKey: true }), keymap)).toBe("find");
  });

  it("unbinds an action given an empty chord list", () => {
    const overrides = withOverride(
      NO_KEYBINDING_OVERRIDES,
      "macos",
      "clear-buffer",
      [],
    );
    const keymap = resolveKeymap("macos", overrides);
    expect(chordsForAction(keymap, "clear-buffer")).toEqual([]);
    expect(matchBinding(keyEvent("k", { metaKey: true }), keymap)).toBeNull();
  });

  it("keeps every other action's shipped chords untouched", () => {
    const overrides = withOverride(NO_KEYBINDING_OVERRIDES, "macos", "find", [
      { key: "j", meta: true },
    ]);
    const keymap = resolveKeymap("macos", overrides);
    expect(matchBinding(keyEvent("d", { metaKey: true }), keymap)).toBe(
      "split-row",
    );
    expect(keymap).toHaveLength(MACOS_KEYMAP.length);
  });

  it("ignores an override naming an action that does not exist", () => {
    const keymap = resolveKeymap("macos", {
      macos: { "not-an-action": [{ key: "q", meta: true }] },
      windows: {},
    });
    expect(matchBinding(keyEvent("q", { metaKey: true }), keymap)).toBeNull();
  });
});

describe("withOverride", () => {
  it("clears an override rather than storing an empty list", () => {
    // "reset to default" and "unbind" are different outcomes; storing `[]` for
    // a reset would silently turn one into the other.
    const set = withOverride(NO_KEYBINDING_OVERRIDES, "macos", "find", [
      { key: "j", meta: true },
    ]);
    expect(isOverridden(set, "macos", "find")).toBe(true);

    const cleared = withOverride(set, "macos", "find", null);
    expect(isOverridden(cleared, "macos", "find")).toBe(false);
    expect(resolveKeymap("macos", cleared)).toBe(MACOS_KEYMAP);
  });

  it("touches only the platform it is given", () => {
    const set = withOverride(NO_KEYBINDING_OVERRIDES, "macos", "find", [
      { key: "j", meta: true },
    ]);
    expect(isOverridden(set, "windows", "find")).toBe(false);
    expect(resolveKeymap("windows", set)).toBe(WINDOWS_KEYMAP);
  });
});

describe("chordConflicts", () => {
  it("finds nothing in either shipped keymap", () => {
    // Also a regression check on the keymaps themselves: a duplicate chord
    // there would mean a shipped shortcut silently shadows another.
    expect([...chordConflicts(MACOS_KEYMAP).keys()]).toEqual([]);
    expect([...chordConflicts(WINDOWS_KEYMAP).keys()]).toEqual([]);
  });

  it("names both actions claiming one chord", () => {
    const overrides = withOverride(NO_KEYBINDING_OVERRIDES, "macos", "find", [
      { key: "d", meta: true },
    ]);
    const conflicts = chordConflicts(resolveKeymap("macos", overrides));
    const clash = conflicts.get(chordId({ key: "d", meta: true }));
    expect(clash).toEqual(["find", "split-row"]);
  });

  it("does not call one action bound twice to a chord a conflict", () => {
    const overrides = withOverride(NO_KEYBINDING_OVERRIDES, "macos", "find", [
      { key: "j", meta: true },
      { key: "j", meta: true },
    ]);
    expect(chordConflicts(resolveKeymap("macos", overrides)).size).toBe(0);
  });
});

describe("validateKeybindings", () => {
  it("returns empty buckets for junk", () => {
    expect(validateKeybindings(null)).toEqual(NO_KEYBINDING_OVERRIDES);
    expect(validateKeybindings("⌘D")).toEqual(NO_KEYBINDING_OVERRIDES);
    expect(validateKeybindings({ macos: [] })).toEqual(NO_KEYBINDING_OVERRIDES);
  });

  it("drops only the unreadable entries, keeping the rest", () => {
    // Falling back wholesale would discard every rebind the user made because
    // one entry went bad.
    const result = validateKeybindings({
      macos: {
        find: [{ key: "j", meta: true }],
        "not-an-action": [{ key: "q", meta: true }],
        "split-row": [{ nonsense: true }],
        "clear-buffer": "⌘K",
      },
      windows: {},
    });
    expect(result.macos).toEqual({ find: [{ key: "j", meta: true }] });
  });

  it("refuses a chord list longer than the cap", () => {
    const tooMany = Array.from({ length: MAX_CHORDS_PER_ACTION + 1 }, () => ({
      key: "j",
      meta: true,
    }));
    expect(validateKeybindings({ macos: { find: tooMany } }).macos).toEqual({});
  });

  it("round-trips what withOverride writes", () => {
    const written = withOverride(NO_KEYBINDING_OVERRIDES, "windows", "find", [
      { key: "j", ctrl: true, shift: true, alt: false, meta: false },
    ]);
    expect(validateKeybindings(JSON.parse(JSON.stringify(written)))).toEqual(
      written,
    );
  });
});

describe("chordOf", () => {
  it("survives a round trip through every shipped binding", () => {
    // The store holds chords, the keymap holds bindings. If the split lost a
    // modifier, a rebind of one action would quietly alter another's chord.
    for (const binding of [...MACOS_KEYMAP, ...WINDOWS_KEYMAP]) {
      const chord: Chord = chordOf(binding);
      expect(isChord(chord)).toBe(true);
      expect(chordId(chord)).toBe(chordId(chordOf(binding)));
    }
  });
});

describe("every registry action is addressable as an override", () => {
  it("accepts each id, so no action is unrebindable", () => {
    for (const action of ACTION_REGISTRY) {
      const overrides = withOverride(
        NO_KEYBINDING_OVERRIDES,
        "macos",
        action.id,
        [{ key: "j", meta: true, alt: true, ctrl: true, shift: true }],
      );
      // Survives the store round trip — an id the validator drops would make
      // that action's rebind vanish on the next launch.
      expect(
        validateKeybindings(JSON.parse(JSON.stringify(overrides))).macos[
          action.id
        ],
      ).toBeDefined();
    }
  });
});
