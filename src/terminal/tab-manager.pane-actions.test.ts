// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaneProcessInfo } from "../lib/process-info";
import { createMemoryPtyClient } from "./pty-client";
import { createTabManager, type TabManager } from "./tab-manager";
import {
  agentQuickPickerOpen,
  boardOpen,
  editorRequest,
  persistError,
  promptsOpen,
  saveDialogOpen,
  settingsOpen,
} from "../chrome/events";
import { activeTabIndex, tabViews } from "./tabs-store";
import { sessionsSupported } from "../sessions/sessions-store";
import { settings } from "../settings/settings-store";
import { DEFAULT_SETTINGS } from "../settings/settings-schema";
import { sendAgentNotification } from "../lib/native-notification";
import { initializeDesktopEnvironment, resetDesktopEnvironmentForTests } from "../lib/platform";
import {
  type EmitSignal,
  flush,
  type FocusPaneDirectly,
  freshWindowFocusController,
  processInfo,
  setup,
  wire,
} from "./tab-manager.fixtures";

// Task 23: the production-default notifier sends through this adapter. Mock
// it at the module boundary so NO test can ever reach the real Tauri
// `@tauri-apps/plugin-notification` API, regardless of the
// `agentNotifications` setting's value at the time.
vi.mock("../lib/native-notification", () => ({
  sendAgentNotification: vi.fn(),
}));

// init() installs the file-drop listener, which reaches into the Tauri window
// and webview. Stub them so init() can register the pty output listener the
// unread tracking hangs off of. `getCurrentWindow` is also how Task 11 reads
// initial focus + subscribes to focus changes — the controller below lets
// each test steer `isFocused()`/`onFocusChanged()` (resolve, reject, or fire
// a focus change) without re-mocking the module per test.
// Local to this file, not imported from tab-manager.fixtures.ts: `beforeEach`
// below reassigns `windowFocus`, and an ES import is a read-only live
// binding — reassigning it from outside its declaring module isn't legal.
// Do not "deduplicate" this into the fixtures module; it would break every
// beforeEach in every split file that has one of these blocks.
let windowFocus = freshWindowFocusController();
const windowCloseCalls: number[] = [];

vi.mock("../host/window-host", () => ({
  // `getCurrentWindow` and `getCurrentWebview` were separate Tauri modules and
  // are now one facade, so a single factory must supply both — two vi.mock
  // calls for the same path would silently keep only the last.
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
  getCurrentWindow: () => ({
    scaleFactor: async () => 1,
    // The last tab now closes THIS window rather than quitting the app
    // (spec §9.5). Recorded so the close-routing test can assert it.
    close: async () => {
      windowCloseCalls.push(Date.now());
    },
    isFocused: async () => {
      if (windowFocus.isFocusedError) {
        throw windowFocus.isFocusedError;
      }
      return windowFocus.initialFocused;
    },
    onFocusChanged: async (handler: (event: { payload: boolean }) => void) => {
      if (windowFocus.onFocusChangedError) {
        throw windowFocus.onFocusChangedError;
      }
      windowFocus.emitFocusChanged = (focused) => handler({ payload: focused });
      return windowFocus.unlistenFocus;
    },
  }),
}));

beforeEach(() => {
  resetDesktopEnvironmentForTests();
  initializeDesktopEnvironment({
    platform: "macos",
    homeDir: "/Users/dev",
  });
  document.body.innerHTML = "";
  tabViews.value = [];
  activeTabIndex.value = 0;
  windowFocus = freshWindowFocusController();
  // Task 23: reset the live setting the production-default notifier reads,
  // and clear the mocked native adapter so per-test call counts start fresh.
  settings.value = DEFAULT_SETTINGS;
  vi.mocked(sendAgentNotification).mockClear();
});

// `newTab()` (the "new-tab" action) flips this module signal — a global
// reset, not a per-describe one like `boardOpen`'s scattered resets in the
// action-dispatch/chord-actions split files, because leaving it true after
// whichever test exercises "new-tab" would silently rank every later test's
// `openOverlayRanks()` at "modal", failing unrelated pane-tiered assertions
// with no visible connection to the cause.
afterEach(() => {
  agentQuickPickerOpen.value = false;
});

/**
 * One tab holding one pane the poll reports as `agent`, with the attention
 * tracker driven all the way to `phase: "idle"`.
 *
 * The OSC emit is not decoration. `freshState()` starts a pane at
 * `phase: "unknown"` and `noteProcess`'s pre-poll→agent branch leaves the
 * phase alone, so a poll opens the process gate while gate 2
 * (`phase === "idle"`) still refuses — every submit would degrade to
 * `"pasted"` and read like a gate bug. `init()` is equally load-bearing:
 * the memory client's `emitOutput` only reaches listeners registered inside
 * `init()`, so without it the emit is a silent no-op.
 */
async function mountManagerWithAgentPane(agent: NonNullable<PaneProcessInfo["agent"]>): Promise<{
  manager: TabManager;
  pty: ReturnType<typeof createMemoryPtyClient>;
  emitSignal: EmitSignal;
  focusPaneDirectly: FocusPaneDirectly;
}> {
  const infos = new Map<number, PaneProcessInfo>([
    [1, processInfo(1, "/repo", agent, "agent", agent)],
  ]);
  const { tm, pty, emitSignal, focusPaneDirectly } = setup({ infos });
  await tm.openFromPreset({ type: "leaf" }, ["/repo"], {
    workspacePath: "/repo",
  });
  await tm.init();
  await flush();
  pty.emitOutput(1, "\x1b]9;4;0\x07"); // OSC 9;4 state 0 → idle
  return { manager: tm, pty, emitSignal, focusPaneDirectly };
}

describe("injectIntoPane", () => {
  it("pastes and sends when the gate holds", async () => {
    const { manager, pty } = await mountManagerWithAgentPane("claude");
    const paneId = manager.activePaneId();
    expect(paneId).not.toBeNull();
    await expect(
      manager.injectIntoPane(paneId as number, "review this", {
        autoSend: true,
        expectedAgent: "claude",
      }),
    ).resolves.toBe("sent");
    await flush();
    // Indexed, not `.at(-1)`: the repo's tsconfig `lib` predates ES2022.
    expect(pty.writes[pty.writes.length - 1]).toEqual({
      id: paneId,
      data: "\r",
    });
    manager.dispose();
  });

  it("pastes without sending when autoSend is off", async () => {
    const { manager, pty } = await mountManagerWithAgentPane("claude");
    const paneId = manager.activePaneId() as number;
    await expect(
      manager.injectIntoPane(paneId, "review this", {
        autoSend: false,
        expectedAgent: "claude",
      }),
    ).resolves.toBe("pasted");
    await flush();
    expect(pty.writes.some((write) => write.data === "\r")).toBe(false);
    manager.dispose();
  });

  it("withholds the submit when the pane changed agent since capture", async () => {
    const { manager, pty } = await mountManagerWithAgentPane("codex");
    const paneId = manager.activePaneId() as number;
    await expect(
      manager.injectIntoPane(paneId, "review this", {
        autoSend: true,
        expectedAgent: "claude",
      }),
    ).resolves.toBe("pasted");
    await flush();
    expect(pty.writes.some((write) => write.data === "\r")).toBe(false);
    manager.dispose();
  });

  it("reports no target for an unknown pane", async () => {
    const { manager } = await mountManagerWithAgentPane("claude");
    await expect(
      manager.injectIntoPane(9999, "x", {
        autoSend: false,
        expectedAgent: null,
      }),
    ).resolves.toBe("no-target");
    manager.dispose();
  });

  it("withholds submit when focus acknowledges attention during injection", async () => {
    const { manager, pty, emitSignal, focusPaneDirectly } =
      await mountManagerWithAgentPane("claude");
    const paneId = manager.activePaneId() as number;
    const infoGate: {
      release?: (infos: PaneProcessInfo[]) => void;
    } = {};
    pty.ptyInfo = () =>
      new Promise<PaneProcessInfo[]>((resolve) => {
        infoGate.release = resolve;
      });
    emitSignal(paneId, {
      kind: "requested",
      source: "osc-notification",
    });

    const injection = manager.injectIntoPane(paneId, "review this", {
      autoSend: true,
      expectedAgent: "claude",
    });
    await flush();
    focusPaneDirectly(paneId);
    if (infoGate.release === undefined) {
      throw new Error("fresh pty_info did not start");
    }
    infoGate.release([processInfo(paneId, "/repo", "claude", "agent", "claude")]);

    await expect(injection).resolves.toBe("pasted");
    await flush();
    expect(pty.writes.some((write) => write.data === "\r")).toBe(false);
    manager.dispose();
  });

  it("never submits when the paste write fails", async () => {
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/repo", "claude", "agent", "claude")],
    ]);
    const memory = createMemoryPtyClient({ nextId: 1, infos });
    const writes: string[] = [];
    const pty = {
      ...memory,
      async writePty(_id: number, data: string): Promise<void> {
        writes.push(data);
        if (data === "review this") {
          throw new Error("paste failed");
        }
      },
    };
    const { tm: manager } = wire(pty);
    await manager.openFromPreset({ type: "leaf" }, ["/repo"], {
      workspacePath: "/repo",
    });
    await manager.init();
    await flush();
    memory.emitOutput(1, "\x1b]9;4;0\x07");

    await expect(
      manager.injectIntoPane(1, "review this", {
        autoSend: true,
        expectedAgent: "claude",
      }),
    ).resolves.toBe("failed");
    await flush();
    expect(writes).toEqual(["review this"]);
    manager.dispose();
  });

  it("rejects an overlapping injection into the same pane before writing", async () => {
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/repo", "claude", "agent", "claude")],
    ]);
    const memory = createMemoryPtyClient({ nextId: 1, infos });
    const writeControl: { release?: () => void } = {};
    const writeGate = new Promise<void>((resolve) => {
      writeControl.release = resolve;
    });
    const writeStarted = vi.fn();
    const writes: string[] = [];
    const pty = {
      ...memory,
      async writePty(_id: number, data: string): Promise<void> {
        writes.push(data);
        writeStarted();
        await writeGate;
      },
    };
    const { tm: manager } = wire(pty);
    await manager.openFromPreset({ type: "leaf" }, ["/repo"], {
      workspacePath: "/repo",
    });

    const first = manager.injectIntoPane(1, "first", {
      autoSend: false,
      expectedAgent: "claude",
    });
    await vi.waitFor(() => expect(writeStarted).toHaveBeenCalledTimes(1));

    let overlappingOutcome: string | undefined;
    const overlapping = manager
      .injectIntoPane(1, "second", {
        autoSend: false,
        expectedAgent: "claude",
      })
      .then((outcome) => {
        overlappingOutcome = outcome;
        return outcome;
      });
    await flush();
    const outcomeBeforeFirstCompletes = overlappingOutcome;
    expect(writes).toEqual(["first"]);

    if (writeControl.release === undefined) {
      throw new Error("write gate was not initialized");
    }
    writeControl.release();
    await expect(Promise.all([first, overlapping])).resolves.toEqual(["pasted", "busy"]);
    expect(outcomeBeforeFirstCompletes).toBe("busy");
    manager.dispose();
  });
});

describe("toggle-prompts", () => {
  beforeEach(() => {
    promptsOpen.value = false;
    persistError.value = null;
    // `scope: "pane"` blocks this action while ANY overlay is open, so all
    // four overlay signals have to be cleared — not just the board. None of
    // them are reset by the shared top-level `beforeEach` above (only
    // `tabViews`/`activeTabIndex`/`settings`/the notifier mock are), so this
    // resets them explicitly rather than relying on the chrome/events
    // module's own initial `false`/`null` defaults holding. (`scroll-page-
    // up/down`, now in tab-manager.chord-actions.test.ts, does reset
    // `settingsOpen` in its own `afterEach` — this reset doesn't depend on
    // that either way, it's unconditional.)
    boardOpen.value = false;
    settingsOpen.value = false;
    editorRequest.value = null;
    saveDialogOpen.value = false;
  });

  it("opens the popover signal when a pane is focused", async () => {
    const { manager } = await mountManagerWithAgentPane("claude");
    manager.runAction("toggle-prompts");
    expect(promptsOpen.value).toBe(true);
    manager.runAction("toggle-prompts");
    expect(promptsOpen.value).toBe(false);
    manager.dispose();
  });

  it("says so instead of opening with no pane to paste into", () => {
    const manager = createTabManager(document.createElement("div"), createMemoryPtyClient());
    manager.runAction("toggle-prompts");
    expect(promptsOpen.value).toBe(false);
    expect(persistError.value).toBe("No pane to paste into.");
    manager.dispose();
  });
});

describe("toggle-explorer", () => {
  beforeEach(() => {
    // Same reasoning as `toggle-prompts` above: `scope: "pane"` blocks this
    // action while ANY overlay is open, and none of the four signals are
    // reset by the shared top-level `beforeEach`, so this resets them
    // explicitly rather than trusting the chrome/events module's defaults.
    boardOpen.value = false;
    settingsOpen.value = false;
    editorRequest.value = null;
    saveDialogOpen.value = false;
    settings.value = DEFAULT_SETTINGS;
  });

  afterEach(() => {
    settings.value = DEFAULT_SETTINGS;
  });

  it("flips dockOpen on each call, with no pane required", () => {
    const manager = createTabManager(document.createElement("div"), createMemoryPtyClient());
    expect(settings.value.dockOpen).toBe(false);
    manager.runAction("toggle-explorer");
    expect(settings.value.dockOpen).toBe(true);
    manager.runAction("toggle-explorer");
    expect(settings.value.dockOpen).toBe(false);
    manager.dispose();
  });
});

describe("toggle-usage", () => {
  beforeEach(() => {
    // Same reasoning as `toggle-prompts` above: `settingsOpen` is not reset
    // by the shared top-level `beforeEach`, which would block a
    // `"pane"`-tiered action for the wrong reason and turn an assertion into
    // a false pass, so this resets it (and its siblings) explicitly.
    boardOpen.value = false;
    settingsOpen.value = false;
    editorRequest.value = null;
    saveDialogOpen.value = false;
  });

  afterEach(() => {
    settingsOpen.value = false;
  });

  it("routes through the onToggleUsage seam instead of writing the signal", async () => {
    const onToggleUsage = vi.fn();
    const { tm } = setup({ deps: { onToggleUsage } });
    await tm.init();
    await flush();

    tm.runAction("toggle-usage");

    expect(onToggleUsage).toHaveBeenCalledTimes(1);
    // The seam owns the reveal — TabManager must never reach into the dock
    // itself, or the reveal-and-focus rule would live in two places.
    expect(settings.value.dockOpen).toBe(false);
    tm.dispose();
  });

  it("is a safe no-op when no seam is supplied", async () => {
    const { tm } = setup({});
    await tm.init();
    await flush();

    expect(() => tm.runAction("toggle-usage")).not.toThrow();
    expect(settings.value.dockOpen).toBe(false);
    tm.dispose();
  });

  it("is blocked while Settings covers the grid — an ordinary 'pane' tier now that usage is a dock tab", async () => {
    const onToggleUsage = vi.fn();
    const { tm } = setup({ deps: { onToggleUsage } });
    await tm.init();
    await flush();
    settingsOpen.value = true;

    tm.runAction("toggle-usage");

    expect(onToggleUsage).not.toHaveBeenCalled();
    tm.dispose();
  });
});

// The session history screen is the third surface pushed at
// `TIER_RANK.settings` by `openOverlayRanks()`. It had NO action until
// 2026-08-19 — the file-explorer spec §3.1 shipped it as "toolbar control
// only, no shortcut, no menu item", which is why only the RANK half of the
// `toggle-usage` block above used to transfer here. `toggle-sessions` exists
// now, so the seam half is testable and lives below.
describe("toggle-sessions (2026-08-19)", () => {
  beforeEach(() => {
    boardOpen.value = false;
    settingsOpen.value = false;
    editorRequest.value = null;
    saveDialogOpen.value = false;
    settings.value = { ...DEFAULT_SETTINGS };
    sessionsSupported.value = true;
  });

  afterEach(() => {
    settingsOpen.value = false;
    sessionsSupported.value = true;
  });

  it("reveals the sessions tab, opening the column on it", async () => {
    const { tm } = setup({});
    await tm.init();
    await flush();

    tm.runAction("toggle-sessions");

    expect(settings.value.dockOpen).toBe(true);
    expect(settings.value.dockTab).toBe("sessions");
    tm.dispose();
  });

  // The guard its two sibling tabs do not need. `availableDockTabs` drops
  // this tab on a host with no `sessions_list` and `resolveDockTab` falls the
  // column back to explorer — so an unguarded reveal would answer
  // "Session History" by opening the FILE EXPLORER.
  it("says so instead of opening the wrong tab where the host has no sessions", async () => {
    sessionsSupported.value = false;
    const { tm } = setup({});
    await tm.init();
    await flush();

    tm.runAction("toggle-sessions");

    expect(settings.value.dockOpen).toBe(false);
    expect(settings.value.dockTab).not.toBe("sessions");
    expect(persistError.value).toContain("Session history");
    tm.dispose();
  });
});
