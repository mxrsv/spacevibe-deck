// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  boardOpen,
  editorRequest,
  saveDialogOpen,
  settingsOpen,
} from "../chrome/events";
import {
  closeSettingsPanel,
  livePresetOpensATab,
  toggleSettingsPanel,
} from "./app";
import { ACTION_REGISTRY, TIER_RANK } from "../terminal/action-registry";

// Escape-stacking investigation (team lead thread): Settings' own mount-focus
// effect (settings-panel.tsx) steals DOM focus onto its close button the
// moment it opens, even over an already-open PresetEditor/SavePresetDialog —
// so a later Escape closes only Settings and orphans focus behind a modal
// that is still fully visible (.modal-scrim z-index 40 > .panel z-index 20,
// styles.css). Fix: block toggle-settings' OPEN branch while a draft is up;
// CLOSE stays unconditional so Settings can never strand itself open (the
// exact trap b7e6021 already had to avoid for the overlay scope guard).
describe("toggleSettingsPanel — blocks opening over a PresetEditor/SavePresetDialog draft, never blocks closing", () => {
  const focusActive = vi.fn();

  beforeEach(() => {
    boardOpen.value = false;
    settingsOpen.value = false;
    editorRequest.value = null;
    saveDialogOpen.value = false;
    focusActive.mockClear();
  });

  afterEach(() => {
    boardOpen.value = false;
    settingsOpen.value = false;
    editorRequest.value = null;
    saveDialogOpen.value = false;
  });

  it("opens Settings normally when no overlay holds a draft", () => {
    toggleSettingsPanel(focusActive);

    expect(settingsOpen.value).toBe(true);
  });

  it("does NOT open Settings while a PresetEditor draft is up", () => {
    editorRequest.value = { source: "live" };

    toggleSettingsPanel(focusActive);

    expect(settingsOpen.value).toBe(false);
  });

  it("does NOT open Settings while a SavePresetDialog draft is up", () => {
    saveDialogOpen.value = true;

    toggleSettingsPanel(focusActive);

    expect(settingsOpen.value).toBe(false);
  });

  // F3 (2026-07-27 code review): the open branch only ever checked
  // editorRequest/saveDialogOpen, missing boardOpen — Cmd+, (or the menu's
  // "Settings…" item) mounted Settings underneath the Open board (z-30 >
  // Settings' z-20). SettingsPanel's own mount-focus effect then stole DOM
  // focus away from the board, so arrow keys / type-to-filter / Enter all
  // stopped reaching it while the invisible Settings panel silently ate
  // them instead.
  it("does NOT open Settings while the Open board is up (F3)", () => {
    boardOpen.value = true;

    toggleSettingsPanel(focusActive);

    expect(settingsOpen.value).toBe(false);
  });

  it("still CLOSES Settings when it is already open, even with a PresetEditor draft also up (the trap b7e6021 already had to avoid)", () => {
    settingsOpen.value = true;
    editorRequest.value = { source: "live" }; // both open at once — an edge case, not the common path

    toggleSettingsPanel(focusActive);

    expect(settingsOpen.value).toBe(false);
    expect(focusActive).toHaveBeenCalledTimes(1);
  });

  it("still CLOSES Settings when it is already open, even with the Open board also up — same invariant, now covering F3's new boardOpen check", () => {
    settingsOpen.value = true;
    boardOpen.value = true;

    toggleSettingsPanel(focusActive);

    expect(settingsOpen.value).toBe(false);
    expect(focusActive).toHaveBeenCalledTimes(1);
  });

  it("still closes Settings normally with no draft open at all", () => {
    settingsOpen.value = true;

    toggleSettingsPanel(focusActive);

    expect(settingsOpen.value).toBe(false);
    expect(focusActive).toHaveBeenCalledTimes(1);
  });
});

// ⌘⇧N is deliberately reachable from the Open board (F4 retiered it "modal",
// above the board's "board" rank) so a layout can be sketched from scratch on
// the app's landing screen. The live-window tail of handleEditorCreate then
// materialized a tab anyway — behind the board (z-30 covers the stage), whose
// pane silently took DOM focus, and with no tab open yet there was no active
// pane to inherit a CWD from, so it spawned in $HOME instead of the folder
// selected on the board. Saving the preset and leaving the board up matches
// what the `source: "board"` branch already does with no workspace picked.
describe("livePresetOpensATab — ⌘⇧N over the Open board saves the preset without opening a tab", () => {
  it("opens a tab in a live window, where the stage is actually visible", () => {
    expect(livePresetOpensATab(false)).toBe(true);
  });

  it("does NOT open a tab while the Open board covers the stage", () => {
    expect(livePresetOpensATab(true)).toBe(false);
  });

  // The guard above only matters because new-preset outranks the board. If
  // anyone retiers it back to "board" (or lower), the overlay guard blocks
  // ⌘⇧N on the board outright and this whole branch becomes dead code — fail
  // here so that is a deliberate decision, not a silent one.
  it("is only reachable because new-preset outranks the board tier", () => {
    const newPreset = ACTION_REGISTRY.find(
      (action) => action.id === "new-preset",
    );
    expect(newPreset?.scope).toBe("modal");
    expect(TIER_RANK.modal).toBeGreaterThan(TIER_RANK.board);
  });
});

describe("closeSettingsPanel", () => {
  afterEach(() => {
    settingsOpen.value = false;
  });

  it("always closes and hands off focus, unconditionally", () => {
    settingsOpen.value = true;
    editorRequest.value = { source: "live" };
    const focusActive = vi.fn();

    closeSettingsPanel(focusActive);

    expect(settingsOpen.value).toBe(false);
    expect(focusActive).toHaveBeenCalledTimes(1);

    editorRequest.value = null;
  });
});
