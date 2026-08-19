/* oxlint-disable jest/valid-expect, vitest/valid-expect -- vitest expect() takes a failure message as its second argument */
import { describe, expect, it } from "vitest";
import {
  NOT_REBINDABLE,
  SHORTCUT_GROUPS,
  TAB_SELECT_COUNT,
  shortcutGroups,
} from "./shortcut-groups";
import { DISPATCHABLE_ACTIONS } from "../../terminal/tab-action-scope";
import {
  ACTION_REGISTRY,
  MACOS_KEYMAP,
  WINDOWS_KEYMAP,
  isActionId,
} from "../../terminal/action-registry";

const rows = () => shortcutGroups().flatMap((group) => group.rows);

describe("shortcutGroups", () => {
  it("gives every DISPATCHABLE registry action a row", () => {
    // The whole point of building from the registry: an action with no row is
    // an action nobody can rebind, and it would go unnoticed.
    const actions = new Set(rows().map((row) => row.action));
    for (const action of ACTION_REGISTRY) {
      if (NOT_REBINDABLE.has(action.id)) {
        continue;
      }
      expect(actions.has(action.id), action.id).toBe(true);
    }
  });

  it("offers no row a chord could not actually run", () => {
    // A row whose action `dispatchAction` has no entry for renders an editable
    // pill over a permanent no-op: the chord shows, pressing it does nothing.
    for (const row of rows()) {
      expect(DISPATCHABLE_ACTIONS.has(row.action), row.action).toBe(true);
    }
  });

  it("excludes exactly the non-dispatchable actions, no more", () => {
    // Keeps the exclusion honest in both directions: an action that becomes
    // dispatchable later must not stay silently hidden, and the set cannot
    // grow into a place to bury inconvenient rows.
    const undispatchable = (ACTION_REGISTRY as readonly { id: string }[])
      .filter((action) => !DISPATCHABLE_ACTIONS.has(action.id as never))
      .map((action) => action.id)
      .sort();
    expect([...NOT_REBINDABLE].sort()).toEqual(undispatchable);
  });

  it("places every action — the `other` bucket must stay empty", () => {
    // `other` exists so an unplaced action still appears rather than
    // vanishing. Its being non-empty is the signal to place it in PLACEMENT.
    const other = shortcutGroups().find((group) => group.id === "other");
    expect(other?.rows.map((row) => row.action) ?? []).toEqual([]);
  });

  it("synthesizes the select-tab-N family the registry deliberately omits", () => {
    const actions = rows().map((row) => row.action);
    for (let index = 1; index <= TAB_SELECT_COUNT; index += 1) {
      expect(actions).toContain(`select-tab-${index}`);
    }
    // Right after `select-last-tab`, in the same group — they are one family
    // to the user even though only one of them is a registry row.
    const tabs = shortcutGroups().find((group) => group.id === "tabs");
    const last = tabs?.rows.findIndex((row) => row.action === "select-last-tab");
    expect(last).toBeGreaterThanOrEqual(0);
    expect(tabs?.rows[(last ?? 0) + 1]?.action).toBe("select-tab-1");
  });

  it("names every row with an id the override map will accept", () => {
    // A row whose action `isActionId` rejects would render a control whose
    // writes `validateKeybindings` silently drops on the next launch.
    for (const row of rows()) {
      expect(isActionId(row.action), row.action).toBe(true);
      expect(row.label.trim()).not.toBe("");
    }
  });

  it("lists no action twice", () => {
    const actions = rows().map((row) => row.action);
    expect(new Set(actions).size).toBe(actions.length);
  });

  it("covers every action either keymap can actually fire", () => {
    // A chord bound to an action with no row is a shortcut the user can hit
    // and never find.
    const actions = new Set(rows().map((row) => row.action));
    for (const binding of [...MACOS_KEYMAP, ...WINDOWS_KEYMAP]) {
      expect(actions.has(binding.action), binding.action).toBe(true);
    }
  });

  it("drops empty groups but keeps declared order", () => {
    const shown = shortcutGroups().map((group) => group.id);
    const declared = SHORTCUT_GROUPS.map((group) => group.id).filter((id) => shown.includes(id));
    expect(shown).toEqual(declared);
  });
});
