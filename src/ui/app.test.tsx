// @vitest-environment jsdom
import { render } from "preact";
import { readFileSync } from "node:fs";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { boardOpen, editorRequest, saveDialogOpen, settingsOpen } from "../chrome/events";
import {
  boardClosesAfterResume,
  bootOpensTheBoard,
  browserPanelObscured,
  closeSettingsPanel,
  dockPaintedOpen,
  dockToggleOnStage,
  dockVisible,
  liveRailAvailable,
  livePresetOpensATab,
  sidebarEffectivelyCollapsed,
  stripShowsTabs,
  toggleSettingsPanel,
  workspacesOrphanedByClose,
} from "./app-policy";
import { DesktopChrome } from "./desktop-chrome";
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
          status={<footer data-testid="status">status</footer>}
          onMacTitlebarDoubleClick={vi.fn()}
        />,
        host,
      );
    });
    return host.firstElementChild as HTMLElement;
  }

  // DL-18.9 (2026-08-16): the hide control is a WINDOW control, so it sits in
  // the frame row immediately after the traffic-light inset — before the drag
  // spacer, and before anything the app puts in that row.
  it("puts the sidebar hide control right after the traffic lights", () => {
    initializeDesktopEnvironment({ platform: "macos", homeDir: "/Users/deck" });
    act(() => {
      render(
        <DesktopChrome
          sidebar
          sidebarToggle={<button type="button" data-testid="hide" />}
          toolbar={null}
          sidebarNavigation={<nav />}
          topTabs={<header />}
          stage={<main />}
          status={<footer />}
          onMacTitlebarDoubleClick={vi.fn()}
        />,
        host,
      );
    });

    const frame = host.querySelector(".deck-frame")!;
    const order = [...frame.children].map(
      (child) => child.getAttribute("data-testid") ?? child.className,
    );
    expect(order).toEqual(["deck-frame__lights", "hide", "deck-frame__spacer"]);
  });

  // DL-18: there is no separate title bar. The frame is one command row, and it
  // only exists in sidebar mode — in top-tab mode the tab bar IS the frame and
  // carries the toolbar itself.
  it.each([
    ["macos", false, false, false],
    ["macos", true, true, true],
    ["windows", false, false, false],
    ["windows", true, true, false],
  ] as const)(
    "%s %s mode renders only the platform-owned in-app chrome",
    (platform, sidebar, hasFrame, hasLightsInset) => {
      const root = mount(platform, sidebar);

      expect(root.classList.contains(`window--${platform}`)).toBe(true);
      expect(root.classList.contains("window--sidebar")).toBe(sidebar);
      expect(root.querySelector(".deck-frame") !== null).toBe(hasFrame);
      // The traffic-light inset is macOS-only: elsewhere the OS owns that
      // corner, or nothing does, and reserving space would leave a gap.
      expect(root.querySelector(".deck-frame__lights") !== null).toBe(hasLightsInset);
      // The retired elements must not come back — two chrome rows is the shape
      // DL-18 exists to remove.
      expect(root.querySelector(".titlebar")).toBe(null);
      expect(root.querySelector(".deck-toolbar")).toBe(null);
      expect(root.querySelector('[data-testid="sidebar"]') !== null).toBe(sidebar);
      expect(root.querySelector('[data-testid="tabs"]') !== null).toBe(!sidebar);
      expect(root.querySelector('[data-testid="toolbar"]') !== null).toBe(sidebar);
    },
  );

  // The bottom band is a setting (`showStatusBar`, off by default). With no
  // occupant the ROW must go too — a 28px stripe of empty chrome is not a
  // hidden status bar.
  it("drops the status row when nothing occupies it", () => {
    initializeDesktopEnvironment({ platform: "macos", homeDir: "/Users/deck" });
    act(() => {
      render(
        <DesktopChrome
          sidebar
          toolbar={<span />}
          sidebarNavigation={<nav />}
          topTabs={<header />}
          stage={<main />}
          status={null}
          onMacTitlebarDoubleClick={vi.fn()}
        />,
        host,
      );
    });
    const root = host.firstElementChild as HTMLElement;
    expect(root.classList.contains("window--no-status")).toBe(true);
  });

  it("keeps the row while the status bar is shown", () => {
    const root = mount("macos", true);
    expect(root.classList.contains("window--no-status")).toBe(false);
  });
});

describe("settings load recovery layer", () => {
  it("hides a native browser surface while the settings load alert is visible", () => {
    expect(
      browserPanelObscured({
        overlayCoversPane: false,
        agentQuickPickerOpen: false,
        usageConsentOpen: false,
        promptsOpen: false,
        persistErrorVisible: false,
        settingsLoadError: true,
      }),
    ).toBe(true);
  });

  it("hides it under the usage-consent dialog too (DL-29.9)", () => {
    // Same defect class the quick picker shipped with: a launch-time modal on
    // the shared scrim would draw UNDER the native WebContentsView unless the
    // view is told to go.
    expect(
      browserPanelObscured({
        overlayCoversPane: false,
        agentQuickPickerOpen: false,
        usageConsentOpen: true,
        promptsOpen: false,
        persistErrorVisible: false,
        settingsLoadError: false,
      }),
    ).toBe(true);
  });

  it("stacks the settings load alert above the Open board", () => {
    const modalCss = readFileSync("src/styles/10-modals.css", "utf8");
    const boardCss = readFileSync("src/styles/09-open-board.css", "utf8");
    const alertZ = Number(modalCss.match(/\.settings-load-alert\s*\{[^}]*z-index:\s*(\d+)/s)?.[1]);
    const boardZ = Number(boardCss.match(/\.open-board\s*\{[^}]*z-index:\s*(\d+)/s)?.[1]);

    expect(alertZ).toBeGreaterThan(boardZ);
  });
});

// DL-18.6/18.9: in sidebar mode the stage's first `--frame-h` IS the frame row
// — it carries the traffic-light inset, the sidebar's only way back out while
// the column is hidden, the feature toolbar and the dock's control. A
// full-window surface authored `inset: 0` swallowed all of it: with the
// sidebar collapsed and the board up on a window with no tabs (so the board
// cannot even be cancelled), NOTHING on screen could bring the sidebar back.
// Same rectangle rule `.stage__surface` has always used for the document.
describe("full-window surfaces leave the stage strip's row alone", () => {
  it.each([["src/styles/09-open-board.css", ".open-board"]])(
    "%s starts %s below the strip in sidebar mode",
    (file, selector) => {
      const css = readFileSync(file, "utf8");
      const escaped = selector.replace(".", "\\.");
      const rule = css.match(new RegExp(`\\.stage--strip\\s+${escaped}[^{]*\\{[^}]*\\}`, "s"))?.[0];

      expect(rule).toBeDefined();
      expect(rule).toContain("top: var(--frame-h)");
    },
  );

  /**
   * Settings LEFT this rule on 2026-08-19, at the owner's request, and the
   * exemption is conditional — so it is asserted rather than just deleted.
   *
   * The rule above was never "the strip is sacred". It was "do not strand the
   * user": a board opened on a window with no tabs cannot be cancelled, so
   * covering the row left nothing on screen able to bring the sidebar back.
   * Settings covers the whole window now and is safe doing it for one reason
   * only — it has ways out that owe nothing to the chrome underneath. If those
   * ever go, this exemption has to go with them.
   */
  it("lets Settings cover the whole window, and keeps both ways out of it", () => {
    const css = readFileSync("src/styles/11-settings-screen.css", "utf8");
    const shell = css.match(/\.settings-screen\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(shell).toContain("position: fixed");
    expect(shell).toContain("inset: 0");
    expect(css).not.toMatch(/\.stage--strip\s+\.settings-screen\s*\{/);

    // Covering the frame row takes the window's drag surface and the traffic
    // lights' reserved footprint with it, so the header has to carry both.
    const head = css.match(/\.settings-screen__head\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(head).toContain("-webkit-app-region: drag");
    expect(head).toContain("--frame-lights-w");

    // Way out #1 is a real control, not a glyph the user has to interpret.
    const screen = readFileSync("src/ui/settings/settings-screen.tsx", "utf8");
    expect(screen).toContain("settings-screen__back");
    expect(screen).toMatch(/Back/);
    // Way out #2 is the key, and `settings-screen.test.tsx` proves it fires.
    expect(screen).toContain('event.key === "Escape"');
  });
});

// The other half of the same fix: the strip survives a full-window surface, so
// what it carries has to be what still MEANS something over one. The window
// controls do; a list of tab chips does not — the surface replaced the tabs.
// A modal is deliberately absent: it floats on a scrim with the strip legible
// underneath it, and hiding the chips there would be a second, silent change.
describe("stripShowsTabs", () => {
  it("keeps the chips while only the terminal grid is on the stage", () => {
    expect(stripShowsTabs({ boardOpen: false, settingsOpen: false })).toBe(true);
  });

  it.each([
    ["the Open board", true, false],
    ["the Settings screen", false, true],
  ])("drops the chips under %s", (_label, board, settings) => {
    expect(stripShowsTabs({ boardOpen: board, settingsOpen: settings })).toBe(false);
  });
});

describe("Open Board shell visibility", () => {
  it("hides the Agent Rail when no live tab exists", () => {
    expect(liveRailAvailable(0)).toBe(false);
    expect(liveRailAvailable(1)).toBe(true);
  });

  it("temporarily collapses the sidebar without changing its saved choice", () => {
    expect(
      sidebarEffectivelyCollapsed({
        liveTabCount: 0,
        savedCollapsed: false,
        dragCollapsed: false,
      }),
    ).toBe(true);
    expect(
      sidebarEffectivelyCollapsed({
        liveTabCount: 1,
        savedCollapsed: false,
        dragCollapsed: false,
      }),
    ).toBe(false);
  });

  it("suppresses the dock while the board is open without changing dockOpen", () => {
    expect(dockVisible({ boardOpen: true, dockOpen: true })).toBe(false);
    expect(dockVisible({ boardOpen: false, dockOpen: true })).toBe(true);
    expect(dockVisible({ boardOpen: false, dockOpen: false })).toBe(false);
  });

  // DL-19.4, amended 2026-08-19: mid-drag the gesture answers, not the setting
  // — the same way the navigation sidebar's seam has always behaved.
  it("lets an armed drag close the dock before the pointer is released", () => {
    // No drag in flight: the setting is the whole answer.
    expect(dockPaintedOpen({ boardOpen: false, dockOpen: true, dragCollapsed: null })).toBe(true);
    expect(
      dockPaintedOpen({
        boardOpen: false,
        dockOpen: false,
        dragCollapsed: null,
      }),
    ).toBe(false);

    // Dragging past the floor hides it at once; dragging back out brings it
    // back, still without having written anything.
    expect(dockPaintedOpen({ boardOpen: false, dockOpen: true, dragCollapsed: true })).toBe(false);
    expect(
      dockPaintedOpen({
        boardOpen: false,
        dockOpen: false,
        dragCollapsed: false,
      }),
    ).toBe(true);

    // The board still wins over both: it owns the stage.
    expect(dockPaintedOpen({ boardOpen: true, dockOpen: true, dragCollapsed: false })).toBe(false);
  });

  it("closes the board only after a session actually resumes", () => {
    expect(boardClosesAfterResume(true)).toBe(true);
    expect(boardClosesAfterResume(false)).toBe(false);
  });

  // DL-19.3, amended 2026-08-19: the hide control has two mounts and exactly
  // one is ever on screen. An open column carries its own at its outer edge,
  // so the chrome must NOT also carry one.
  it("hands the dock's hide control to the chrome only while the column is gone", () => {
    expect(dockToggleOnStage({ boardOpen: false, dockOpen: false })).toBe(true);
    expect(dockToggleOnStage({ boardOpen: false, dockOpen: true })).toBe(false);
    // Board open: the column is suppressed, but the setting still says open
    // and the board covers the stage — a "show the side panel" button there
    // would promise something the click cannot deliver.
    expect(dockToggleOnStage({ boardOpen: true, dockOpen: true })).toBe(false);
    expect(dockToggleOnStage({ boardOpen: true, dockOpen: false })).toBe(false);
  });
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
// selected on the board. Saving the preset and leaving the board up is the
// whole behaviour now that the board has no layout picker of its own
// (2026-08-16) — the preset is picked up by the next open that remembers it.
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
    const newPreset = ACTION_REGISTRY.find((action) => action.id === "new-preset");
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

// Usage and Settings are mutually exclusive (spec §Surface, major M4): both
// are full-window surfaces at the same z-layer, so two open at once is two
// screens fighting over one rectangle. The guard mirrors
// `toggleSettingsPanel` exactly — CLOSING is unconditional (or the screen
// strands itself open, the b7e6021 trap), OPENING is blocked only by a
// PresetEditor/SavePresetDialog draft at z-40.

describe("workspacesOrphanedByClose — the project close's file sweep (close model, 2026-08-22)", () => {
  const tabs = [
    { workspacePath: "/w/deck" },
    { workspacePath: "/w/deck-side" },
    { workspacePath: "/w/other" },
  ];

  it("orphans a workspace no surviving tab holds", () => {
    expect(workspacesOrphanedByClose(tabs, [0, 1])).toEqual(["/w/deck", "/w/deck-side"]);
  });

  it("does NOT ask the singular question once per tab", () => {
    // Two tabs of ONE workspace, both closing. `workspaceOrphanedByClose` would
    // answer "the sibling survives" for each and strand the file workspace; the
    // survivor set is computed against everything that is closing.
    const pair = [{ workspacePath: "/w/deck" }, { workspacePath: "/w/deck" }, ...tabs.slice(2)];
    expect(workspacesOrphanedByClose(pair, [0, 1])).toEqual(["/w/deck"]);
  });

  it("keeps a workspace a surviving tab still holds", () => {
    const pair = [{ workspacePath: "/w/deck" }, { workspacePath: "/w/deck" }, ...tabs.slice(2)];
    expect(workspacesOrphanedByClose(pair, [0])).toEqual([]);
  });

  it("returns nothing when every tab is going", () => {
    // "Last surface, not last tab" (spec §7) — and since the close model that
    // same branch is what keeps the window standing on the Open board.
    expect(workspacesOrphanedByClose(tabs, [0, 1, 2])).toEqual([]);
  });

  it("ignores a tab with no workspace", () => {
    expect(workspacesOrphanedByClose([{ workspacePath: null }, ...tabs], [0])).toEqual([]);
  });
});
