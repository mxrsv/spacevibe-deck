// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  boardOpen,
  editorRequest,
  saveDialogOpen,
  settingsOpen,
} from "../chrome/events";
import {
  bootOpensTheBoard,
  closeSettingsPanel,
  DesktopChrome,
  boardCanCancel,
  livePresetOpensATab,
  promptsAreDisabled,
  toggleSettingsPanel,
} from "./app";
import { ACTION_REGISTRY, TIER_RANK } from "../terminal/action-registry";
import {
  initializeDesktopEnvironment,
  resetDesktopEnvironmentForTests,
  type DesktopPlatform,
} from "../lib/platform";

describe("DesktopChrome platform structure", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    resetDesktopEnvironmentForTests();
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    act(() => render(null, host));
    resetDesktopEnvironmentForTests();
    document.body.innerHTML = "";
  });

  function mount(platform: DesktopPlatform, sidebar: boolean): HTMLElement {
    initializeDesktopEnvironment({
      platform,
      homeDir: platform === "windows" ? "C:\\Users\\Deck" : "/Users/deck",
    });
    act(() => {
      render(
        <DesktopChrome
          sidebar={sidebar}
          toolbar={<span data-testid="toolbar">toolbar</span>}
          sidebarNavigation={<nav data-testid="sidebar">sidebar</nav>}
          topTabs={<header data-testid="tabs">tabs</header>}
          stage={<main data-testid="stage">stage</main>}
          explorer={null}
          status={<footer data-testid="status">status</footer>}
          onMacTitlebarDoubleClick={vi.fn()}
        />,
        host,
      );
    });
    return host.firstElementChild as HTMLElement;
  }

  it.each([
    ["macos", false, true, false],
    ["macos", true, true, false],
    ["windows", false, false, false],
    ["windows", true, false, true],
  ] as const)(
    "%s %s mode renders only the platform-owned in-app chrome",
    (platform, sidebar, hasTitlebar, hasWindowsToolbar) => {
      const root = mount(platform, sidebar);

      expect(root.classList.contains(`window--${platform}`)).toBe(true);
      expect(root.classList.contains("window--sidebar")).toBe(sidebar);
      expect(root.querySelector(".titlebar") !== null).toBe(hasTitlebar);
      expect(root.querySelector(".deck-toolbar") !== null).toBe(
        hasWindowsToolbar,
      );
      expect(root.querySelector('[data-testid="sidebar"]') !== null).toBe(
        sidebar,
      );
      expect(root.querySelector('[data-testid="tabs"]') !== null).toBe(
        !sidebar,
      );
      expect(root.querySelector('[data-testid="toolbar"]') !== null).toBe(
        sidebar,
      );
    },
  );
});

// Escape-stacking investigation (team lead thread): Settings' own mount-focus
// effect (settings/settings-screen.tsx) steals DOM focus onto its close button the
// moment it opens, even over an already-open PresetEditor/SavePresetDialog —
// so a later Escape closes only Settings and orphans focus behind a modal
// that is still fully visible (.modal-scrim z-index 40 > .settings-screen z-index 20,
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

  // F3 (2026-07-27 code review) originally blocked this: Settings was a 300px
  // drawer at z-20, so opening it under the z-30 board made it invisible while
  // its mount-focus effect still stole DOM focus — arrows / type-to-filter /
  // Enter stopped reaching the board. Settings is now a full-window surface at
  // z-35 that COVERS the board, so the premise is gone and the block with it:
  // a global surface that silently refuses to open reads as a broken app.
  // Drafts (modal-scrim, z-40) still outrank Settings and still block it —
  // covered by the two cases above.
  it("DOES open Settings over the Open board — it now covers the board (z-35 > z-30) instead of hiding under it", () => {
    boardOpen.value = true;

    toggleSettingsPanel(focusActive);

    expect(settingsOpen.value).toBe(true);
  });

  it("still CLOSES Settings when it is already open, even with a PresetEditor draft also up (the trap b7e6021 already had to avoid)", () => {
    settingsOpen.value = true;
    editorRequest.value = { source: "live" }; // both open at once — an edge case, not the common path

    toggleSettingsPanel(focusActive);

    expect(settingsOpen.value).toBe(false);
    expect(focusActive).toHaveBeenCalledTimes(1);
  });

  it("still CLOSES Settings when it is already open, even with the Open board also up", () => {
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

describe("bootOpensTheBoard", () => {
  it("opens the board on a normal boot", () => {
    expect(bootOpensTheBoard({ kind: "normal" })).toBe(true);
  });

  it("skips the board when the window boots to adopt a pane", () => {
    expect(bootOpensTheBoard({ kind: "adopt", token: "t-1" })).toBe(false);
  });
});

describe("promptsAreDisabled", () => {
  // ONE expression, read by `ChromeActions` AND `TabBar`. It used to be written
  // twice, which is exactly how a rule lands in one chrome layout and not the
  // other — spec §7's last row exists for that failure.
  it("allows prompts with a terminal tab focused and nothing covering it", () => {
    expect(
      promptsAreDisabled({
        overlayCoversPane: false,
        terminalTabCount: 1,
        fileSurfaceActive: false,
      }),
    ).toBe(false);
  });

  it("disables prompts while a FILE surface holds the stage", () => {
    // Otherwise the board offers to paste a prompt into an editor.
    expect(
      promptsAreDisabled({
        overlayCoversPane: false,
        terminalTabCount: 1,
        fileSurfaceActive: true,
      }),
    ).toBe(true);
  });

  it("keeps its existing two reasons", () => {
    expect(
      promptsAreDisabled({
        overlayCoversPane: true,
        terminalTabCount: 1,
        fileSurfaceActive: false,
      }),
    ).toBe(true);
    expect(
      promptsAreDisabled({
        overlayCoversPane: false,
        terminalTabCount: 0,
        fileSurfaceActive: false,
      }),
    ).toBe(true);
  });
});

describe("boardCanCancel", () => {
  it("refuses only when there is nothing at all behind the board", () => {
    expect(boardCanCancel(0, 0)).toBe(false);
    expect(boardCanCancel(1, 0)).toBe(true);
  });

  it("allows cancel for a window holding ONLY file tabs", () => {
    // The twelfth invariant site: without this the board cannot be dismissed
    // and the file tabs behind it are unreachable.
    expect(boardCanCancel(0, 1)).toBe(true);
  });
});
