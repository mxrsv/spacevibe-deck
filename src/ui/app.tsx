import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { useSignalEffect } from "@preact/signals";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask, message } from "@tauri-apps/plugin-dialog";
import { installQuitGuard } from "../lib/quit-guard";
import {
  confirmClose,
  QUIT_COPY,
  UPDATE_COPY,
  WINDOW_CLOSE_COPY,
  type ConfirmCopy,
} from "../terminal/close-guard";
import { flushSettingsSave } from "../settings/settings-store";
import { defaultPtyClient } from "../terminal/pty-client";
import type { BootMode } from "../terminal/transfer-client";
import { deriveChromeColors } from "../lib/derive-colors";
import { resolveCwds, type Preset } from "../lib/preset-schema";
import { resolveInheritedCwds } from "../terminal/tab-materialize";
import { settings, updateSettings } from "../settings/settings-store";
import { agentOptions, probeNames } from "../lib/agent-catalog";
import { resolveTheme } from "../settings/themes";
import { isShortcutAction } from "../terminal/keymap";
import { createTabManager, type TabManager } from "../terminal/tab-manager";
import { tabViews } from "../terminal/tabs-store";
import {
  markLastUsed,
  presetsData,
  savePreset,
} from "../presets/presets-store";
import { recordWorkspaceOpen } from "../open-board/workspaces-store";
import { resolveAgentChoice } from "../lib/workspace-recents";
import type { AgentChoice } from "../lib/workspace-recents";
import {
  boardOpen,
  editorRequest,
  promptsOpen,
  reportPersistError,
  saveDialogOpen,
  settingsOpen,
  usageOpen,
} from "../chrome/events";
import { OpenBoard } from "../open-board/open-board";
import { PresetEditor } from "../presets/preset-editor";
import {
  SavePresetDialog,
  type SaveTarget,
} from "../presets/save-preset-dialog";
import type { PresetArtifact } from "../presets/mock-model";
import { PersistErrorBar } from "../presets/persist-error-bar";
import { PromptPopover } from "../prompts/prompt-popover";
import { capturePromptTarget } from "../prompts/inject";
import { defaultPromptAssetsClient } from "../prompts/prompt-assets-client";
import { TabBar } from "./tab-bar";
import { ChromeActions } from "./chrome-actions";
import { WorkspaceSidebar } from "./workspace-sidebar";
import { StatusBar } from "./status-bar";
import { SettingsScreen } from "./settings/settings-screen";
import { UsageScreen } from "./usage/usage-screen";
import { runAttentionFocus } from "./attention-focus-coordinator";
import { getDesktopEnvironment } from "../lib/platform";
import {
  createUpdateController,
  type UpdateController,
} from "../updater/update-controller";
import { activeUpdateController } from "../updater/active-update-controller";
import { loadAppVersion } from "../updater/app-version";
import { UpdateAction } from "../updater/update-action";
import { checkForUpdate, relaunchDeck } from "../updater/tauri-updater-adapter";
import { resolveUpdatePreview } from "../updater/update-preview";
import {
  recordUpdateAttempt,
  takeUpdateOutcome,
} from "../updater/update-attempt-store";
import { attemptMessage } from "../updater/update-attempt";
import {
  isUpdateMenuAction,
  runUpdateMenuAction,
} from "../updater/update-menu-actions";
import { defaultLinkClient } from "../terminal/link-client";

interface DesktopChromeProps {
  readonly sidebar: boolean;
  readonly toolbar: ComponentChildren;
  readonly sidebarNavigation: ComponentChildren;
  readonly topTabs: ComponentChildren;
  readonly stage: ComponentChildren;
  readonly status: ComponentChildren;
  readonly onMacTitlebarDoubleClick: () => void;
}

/** Platform shell only; native Windows system controls stay outside Preact. */
export function DesktopChrome(props: DesktopChromeProps) {
  const platform = getDesktopEnvironment().platform;
  const windows = platform === "windows";
  const classes = [
    "window",
    `window--${platform}`,
    props.sidebar ? "window--sidebar" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div class={classes}>
      {!windows ? (
        <div
          class="titlebar"
          data-tauri-drag-region
          onDblClick={props.onMacTitlebarDoubleClick}
        >
          {props.sidebar ? props.toolbar : null}
        </div>
      ) : props.sidebar ? (
        <div class="deck-toolbar" aria-label="Deck actions">
          {props.toolbar}
        </div>
      ) : null}
      {props.sidebar ? props.sidebarNavigation : props.topTabs}
      {props.stage}
      {props.status}
    </div>
  );
}

/**
 * Pure Settings-close: sets `settingsOpen` false and hands focus back.
 * Extracted to module scope (out of `App()`'s closure) so it and
 * `toggleSettingsPanel` below can be unit-tested directly — this repo has no
 * `<App>`-level render harness, and building one just for this guard would
 * be disproportionate. `App()`'s `closePanel` supplies the real
 * `tabsRef.current?.focusActive()` as `focusActive`.
 */
export function closeSettingsPanel(focusActive: () => void): void {
  settingsOpen.value = false;
  focusActive();
}

/**
 * Settings toggle — shared by the gear button and `⌘,`/the menu's
 * "Settings…" item (both call `App()`'s `toggleSettings` closure below,
 * the literal same function reference, so this guard covers both entry
 * points at once).
 *
 * CLOSING (the `if` branch) stays unconditional — Settings must always be
 * reachable to close, or it could strand itself open forever, the exact
 * trap `b7e6021` already had to design around for the overlay scope guard.
 *
 * OPENING (the `else` branch) is blocked only while a PresetEditor/
 * SavePresetDialog draft is up. A draft's modal-scrim sits at z-index 40,
 * above Settings' 35 (styles.css) — opening Settings underneath one would be
 * invisible and unreachable, while `SettingsScreen`'s mount-focus effect
 * (settings/settings-screen.tsx) still stole DOM focus from the draft, so a
 * later Escape closed the invisible Settings and orphaned focus behind a
 * surface that never moved. Same check `runAttentionFocus` makes for
 * Cmd+Shift+A (attention-focus-coordinator.ts:80-82).
 *
 * The Open board is deliberately NOT in that list any more. F3 (2026-07-27
 * code review) added it because Settings was then a 300px drawer at z-20,
 * genuinely hidden beneath the z-30 board. Settings is now a full-window
 * surface at z-35: it covers the board rather than hiding under it, so it
 * opens from the board like from anywhere else, and closing returns to the
 * board with its selection intact. Blocking it there left the gear button
 * silently inert, which reads as a broken app rather than a deliberate rule.
 *
 * Opening also closes the token usage screen, and `toggleUsagePanel` below
 * closes Settings symmetrically — the two are full-window surfaces at the same
 * layer, so exactly one can be up (spec §Surface, major M4).
 */
export function toggleSettingsPanel(focusActive: () => void): void {
  if (settingsOpen.value) {
    closeSettingsPanel(focusActive);
    return;
  }
  if (editorRequest.value !== null || saveDialogOpen.value) {
    return;
  }
  // Mutual exclusion with the token usage screen (spec §Surface, major M4) —
  // the mirror of the line in `toggleUsagePanel` below. A bare set-state, not
  // `closeUsagePanel`: focus is about to land in the surface that is opening.
  usageOpen.value = false;
  settingsOpen.value = true;
}

/**
 * Pure Usage-close: sets `usageOpen` false and hands focus back. Same shape,
 * same reason, as `closeSettingsPanel` above — extracted to module scope so it
 * is unit-testable without an `<App>`-level render harness, which this repo
 * does not have. `App()`'s `closeUsage` supplies the real
 * `restoreFocusAfterSettings` as `focusActive`.
 */
export function closeUsagePanel(focusActive: () => void): void {
  usageOpen.value = false;
  focusActive();
}

/**
 * Token-usage toggle — shared by the chrome chart button, ⌘⇧U / Ctrl+Shift+U,
 * and the menu's "Token Usage…" item (the last two through `TabManagerDeps`'
 * `onToggleUsage` seam, so all three are the literal same closure).
 *
 * CLOSING (the `if` branch) is unconditional, for the same reason
 * `toggleSettingsPanel` above spells out: a full-window surface that can
 * refuse to close strands itself.
 *
 * OPENING (the `else` branch) is blocked by exactly the same preflight
 * Settings uses — a PresetEditor/SavePresetDialog draft at z-index 40 sits
 * above this surface, so opening underneath one would be invisible and
 * unreachable while `UsageScreen`'s mount-focus effect still stole DOM focus
 * from the live draft. The Open board is deliberately NOT in that list, same
 * as Settings: this screen covers the board rather than hiding under it.
 *
 * Opening also closes Settings (spec §Surface, major M4). It is a bare
 * set-state, NOT `closeSettingsPanel` — that helper hands focus back to the
 * pane, and here focus belongs in the screen that is opening, which takes it
 * on mount. Closing Usage does not put Settings back (§0.3 decision 4):
 * restoring a surface the user displaced is a second behavior nothing
 * specified.
 */
export function toggleUsagePanel(focusActive: () => void): void {
  if (usageOpen.value) {
    closeUsagePanel(focusActive);
    return;
  }
  if (editorRequest.value !== null || saveDialogOpen.value) {
    return;
  }
  settingsOpen.value = false;
  usageOpen.value = true;
}

/**
 * Whether a preset created through the LIVE-WINDOW flow (⌘⇧N, or File ▸ "New
 * Layout Preset…") should also materialize a tab, or stop once the preset is
 * saved.
 *
 * `new-preset` is tiered `"modal"` in action-registry.ts, so it deliberately
 * opens the editor OVER the Open board (rank 30 < 40) — sketching a layout
 * from scratch needs no tab and no workspace, which is the whole point of F4.
 * What must NOT follow is the live-window tail that materializes a tab: the
 * board is still up at z-30 covering the stage, so that tab would be
 * invisible while its pane quietly takes DOM focus behind the board, and on
 * the app's default landing screen (no tabs yet) there is no active pane to
 * inherit a CWD from either — it would spawn in `$HOME` instead of the folder
 * selected on the board.
 *
 * Stopping at the save is exactly what the `source: "board"` branch already
 * does for a preset created with no workspace picked: the board stays up, now
 * showing the new card, and the user opens a folder with it. Extracted to
 * module scope (like `toggleSettingsPanel` above) purely so it is unit
 * testable — this repo has no `<App>`-level render harness.
 */
export function livePresetOpensATab(boardIsOpen: boolean): boolean {
  return !boardIsOpen;
}

/**
 * A window that booted to adopt a pane already has its content: showing the
 * Open board would cover a live terminal with a "pick a folder" screen
 * (spec §9.2). Extracted to module scope for the same reason as
 * `livePresetOpensATab` above — this repo has no `<App>` render harness.
 */
export function bootOpensTheBoard(boot: BootMode): boolean {
  return boot.kind === "normal";
}

export function App({ boot = { kind: "normal" } }: { boot?: BootMode } = {}) {
  const stagesRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<TabManager | null>(null);
  const updaterRef = useRef<UpdateController | null>(null);
  const updatePreview = resolveUpdatePreview(
    window.location.search,
    import.meta.env.DEV,
  );

  if (updaterRef.current === null) {
    updaterRef.current = createUpdateController({
      platform: getDesktopEnvironment().platform,
      check: checkForUpdate,
      confirmInstall: () => {
        const manager = tabsRef.current;
        return manager === null
          ? Promise.resolve(false)
          : confirmClose(manager.allPaneIds(), defaultPtyClient, UPDATE_COPY);
      },
      flush: flushSettingsSave,
      relaunch: relaunchDeck,
      report: (message, error) => console.error(`${message}:`, error),
      recordAttempt: (targetVersion) =>
        recordUpdateAttempt(targetVersion, Date.now()),
    });
    activeUpdateController.value = updaterRef.current;
    void loadAppVersion();
  }
  const updater = updaterRef.current;

  /**
   * Single coordinator-backed entry point for every attention-focus trigger
   * (sidebar/tab-bar status click, Cmd+Shift+A). Reads `hasCandidate` and the
   * overlay snapshot at request time so status click and shortcut always run
   * the same preflight (Task 15). Defined before the mount effect below —
   * which passes it into `createTabManager` as the shortcut seam — so the
   * effect's closure captures the real callback, not a stale reference; the
   * function itself is stable in behavior across renders since every read
   * (`tabsRef.current`, the signals) is live, not closed-over.
   */
  const requestAttentionFocus = (index?: number): void => {
    runAttentionFocus({
      tabIndex: index,
      hasCandidate: tabsRef.current?.hasActionableAttention(index) ?? false,
      overlays: {
        board: boardOpen.value,
        settings: settingsOpen.value,
        usage: usageOpen.value,
        presetEditor: editorRequest.value !== null,
        savePresetDialog: saveDialogOpen.value,
      },
      // Non-focusing set-state — NOT `OpenBoard.onCancel` / `closePanel()`,
      // which focus the active pane and could ack the wrong pane first.
      dismissBoard: () => {
        boardOpen.value = false;
      },
      dismissSettings: () => {
        settingsOpen.value = false;
      },
      // Same rule as `dismissSettings`: ⌘⇧A means "take me to the agent that
      // needs me", so the surface in the way is dropped without anyone else
      // claiming focus first.
      dismissUsage: () => {
        usageOpen.value = false;
      },
      focusAttention: (i) => {
        tabsRef.current?.focusNextAttention(i);
      },
    });
  };

  /**
   * Settings close: also returns focus to the active pane, matching Escape
   * and the gear button. Defined before the mount effect (like
   * `requestAttentionFocus` above) so `toggleSettings` below — passed into
   * `createTabManager` as the `onToggleSettings` seam for ⌘, and the menu's
   * "Settings…" item — captures this, not a stale reference. Delegates to
   * the module-scope `closeSettingsPanel` (see above) so App keeps owning
   * the close+focus-return flow, the same as every other overlay, while the
   * open/close decision itself stays unit-testable.
   */
  /**
   * Where focus belongs once Settings closes. Normally the active pane — but
   * Settings now opens over the Open board (z-35 over z-30), and the board
   * only focuses itself on mount, so returning focus to a pane hidden behind
   * it would leave the visible board keyboard-dead: arrows, type-to-filter
   * and Enter would all go nowhere. Queried from the DOM rather than threaded
   * through a ref because the board owns its own container ref and exposing
   * it upward would widen that component's API for one focus call.
   */
  const restoreFocusAfterSettings = (): void => {
    if (boardOpen.value) {
      document.querySelector<HTMLElement>(".open-board")?.focus();
      return;
    }
    tabsRef.current?.focusActive();
  };

  const closePanel = (): void => {
    closeSettingsPanel(restoreFocusAfterSettings);
  };

  /**
   * Toggle Settings open/closed — shared by the gear button (direct call
   * below), ⌘, (keymap.ts `toggle-settings`), and the menu's "Settings…"
   * item, both of the latter through the `onToggleSettings` seam. Delegates
   * to the module-scope `toggleSettingsPanel` (see above) for the actual
   * open/close decision.
   */
  const toggleSettings = (): void => {
    toggleSettingsPanel(restoreFocusAfterSettings);
  };

  /**
   * Usage close — reuses `restoreFocusAfterSettings` verbatim rather than
   * getting a copy: "where focus belongs once a full-window surface closes"
   * has one answer for both screens (the Open board if it is up, otherwise
   * the active pane), and two copies would drift.
   */
  const closeUsage = (): void => {
    closeUsagePanel(restoreFocusAfterSettings);
  };

  /**
   * Toggle Usage — shared by the chrome chart button (direct call below),
   * ⌘⇧U / Ctrl+Shift+U, and the menu's "Token Usage…" item, the latter two
   * through the `onToggleUsage` seam. Delegates to the module-scope
   * `toggleUsagePanel` for the open/close and mutual-exclusion decision.
   */
  const toggleUsage = (): void => {
    toggleUsagePanel(restoreFocusAfterSettings);
  };

  useEffect(() => {
    const host = stagesRef.current;
    if (!host) {
      return;
    }
    const manager = createTabManager(host, undefined, {
      onRequestAttentionFocus: (tabIndex) => requestAttentionFocus(tabIndex),
      onToggleSettings: () => toggleSettings(),
      onToggleUsage: () => toggleUsage(),
    });
    tabsRef.current = manager;
    if (updatePreview === null) {
      // Read the previous run's breadcrumb before starting a new check: if the
      // last install never landed, the user hears it here rather than
      // wondering why the version never changes. Reporting is fire-and-forget
      // — a diagnostic must never delay the terminal coming up.
      void takeUpdateOutcome().then((outcome) => {
        const message = attemptMessage(outcome);
        if (message !== null) {
          reportPersistError(message);
        }
      });
      void updater.start();
    }
    // Session restore is gone: a normal window always opens on the board
    // (Intent §Constraint). An adopt window opens on the pane it was created
    // for and never shows the board at all (spec §9.2).
    //
    // `init()` runs FIRST in both modes — it installs the PTY output and
    // exit listeners, and an adopted pane is dead without them.
    void manager
      .init()
      .then(() => {
        if (bootOpensTheBoard(boot)) {
          boardOpen.value = true;
          return undefined;
        }
        return manager
          .adoptIntoNewTab(boot.kind === "adopt" ? boot.token : "")
          .then((ok) => {
            if (!ok) {
              // Spec §13: a failed claim in a freshly booted window closes
              // that window — there is nothing else for it to show.
              void getCurrentWindow().close();
            }
          });
      })
      .catch((err: unknown) => {
        // Without this an init failure is an unhandled rejection AND the
        // board never opens, so the window is simply blank with no way
        // forward.
        console.error("Failed to initialize terminals:", err);
        if (bootOpensTheBoard(boot)) {
          boardOpen.value = true;
          return;
        }
        void getCurrentWindow().close();
      });
    return () => {
      manager.dispose();
    };
  }, []);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    // One builder per flow: the dialog title and OK label differ, so a
    // single shared `ask` closure would title a window-close dialog
    // "Quit Deck".
    const answering = (copy: ConfirmCopy) => ({
      ask: (text: string) =>
        ask(text, {
          title: copy.title,
          kind: "warning" as const,
          okLabel: copy.okLabel,
          cancelLabel: "Cancel",
        }),
      flush: flushSettingsSave,
    });
    installQuitGuard({
      quit: {
        ...answering(QUIT_COPY),
        confirm: (requestId: number) => defaultPtyClient.confirmQuit(requestId),
        cancel: (requestId: number) => defaultPtyClient.cancelQuit(requestId),
      },
      close: {
        ...answering(WINDOW_CLOSE_COPY),
        confirm: (requestId: number) =>
          defaultPtyClient.confirmCloseWindow(requestId),
        cancel: (requestId: number) =>
          defaultPtyClient.cancelCloseWindow(requestId),
      },
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch((err: unknown) => {
        console.error("Failed to install quit guard:", err);
      });
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    const unsubs: UnlistenFn[] = [];
    // Every File/Edit/View/Window item whose accelerator the macOS menu now
    // owns, including New/Save Preset (unified onto this path — no more
    // menu:new-preset/menu:save-preset special cases, Task 4). The OS
    // consumes the chord before the webview sees it, so the item has to run
    // the very action the keymap would have — same dispatch table, via
    // `runAction`. The payload crosses an IPC boundary as a plain string, so
    // it is validated rather than cast.
    void listen<string>("menu:action", (event) => {
      if (isUpdateMenuAction(event.payload)) {
        void runUpdateMenuAction(event.payload, {
          controller: updater,
          openUrl: (url) => defaultLinkClient.openUrl(url),
          notify: async (body, kind) => {
            await message(body, { title: "SpaceVibe Deck", kind });
          },
          report: (diagnostic, error) => console.error(`${diagnostic}:`, error),
        });
        return;
      }
      if (isShortcutAction(event.payload)) {
        tabsRef.current?.runAction(event.payload);
      }
    }).then((fn) => unsubs.push(fn));
    return () => unsubs.forEach((fn) => fn());
  }, []);

  // Push theme colors into terminals and the chrome CSS vars
  useSignalEffect(() => {
    const current = settings.value;
    tabsRef.current?.applySettings(current);
    const theme = resolveTheme(current);
    const bg = theme.background ?? "#16161e";
    const fg = theme.foreground ?? "#c0caf5";
    const chrome = deriveChromeColors(bg, fg);
    const rootStyle = document.documentElement.style;
    rootStyle.setProperty("--bg", bg);
    rootStyle.setProperty("--fg", fg);
    rootStyle.setProperty("--accent", theme.blue ?? "#7aa2f7");
    rootStyle.setProperty("--red", theme.red ?? "#f7768e");
    rootStyle.setProperty("--green", theme.green ?? "#9ece6a");
    rootStyle.setProperty("--yellow", theme.yellow ?? "#e0af68");
    rootStyle.setProperty("--magenta", theme.magenta ?? "#bb9af7");
    rootStyle.setProperty("--cyan", theme.cyan ?? "#7dcfff");
    rootStyle.setProperty("--tone", chrome.tone);
    rootStyle.setProperty("--chrome-1", chrome.chrome1);
    rootStyle.setProperty("--chrome-2", chrome.chrome2);
    rootStyle.setProperty("--tab-active-bg", chrome.tabActiveBg);
    rootStyle.setProperty("--input-bg", chrome.inputBg);
    rootStyle.setProperty("--hair", chrome.hair);
    rootStyle.setProperty("--hair-strong", chrome.hairStrong);
    rootStyle.setProperty("--text-primary", chrome.textPrimary);
    rootStyle.setProperty("--text-muted", chrome.textMuted);
    rootStyle.setProperty("--text-faint", chrome.textFaint);
  });

  /** Open board confirm: materialize + record recents + preselect memory. */
  async function handleOpen(
    workspace: string,
    preset: Preset,
    agent: AgentChoice,
  ): Promise<boolean> {
    // Every Open materializes its own tab, including for a workspace that
    // already has one — the same repo can run several sessions side by side.
    const ok = await tabsRef.current?.openFromPreset(
      preset.layout,
      resolveCwds(preset, workspace),
      { workspacePath: workspace, agent },
    );
    if (ok) {
      recordWorkspaceOpen(workspace, preset.id, agent);
      markLastUsed(preset.id);
      boardOpen.value = false;
    }
    return ok ?? false;
  }

  /** Editor confirm: save the preset, then materialize a new tab. */
  async function handleEditorCreate(
    name: string,
    artifact: PresetArtifact,
  ): Promise<void> {
    const preset: Preset = {
      id: crypto.randomUUID(),
      name,
      layout: artifact.layout,
      ...(artifact.cwds ? { cwds: artifact.cwds } : {}),
    };
    savePreset(preset);
    const request = editorRequest.value;
    editorRequest.value = null;
    if (request === null) {
      return;
    }
    if (request.source === "board") {
      if (request.workspace === null) {
        return; // gated like Open — board stays up showing the new card
      }
      // A preset created from the board opens like Open does: first detected
      // agent by default (Shell is opt-in, and only the board offers the opt).
      const customAgents = settings.value.customAgents;
      const detected = await defaultPtyClient
        .detectAgents(probeNames(customAgents))
        .catch((err: unknown) => {
          console.warn("detect_agents failed:", err);
          return [];
        });
      await handleOpen(
        request.workspace,
        preset,
        resolveAgentChoice(undefined, agentOptions(detected, customAgents)),
      );
      return;
    }
    if (!livePresetOpensATab(boardOpen.value)) {
      return; // preset saved; the board stays up showing the new card
    }
    // Live window: inherit panes resolve to the focused pane's CWD;
    // the new tab stays in the active tab's workspace, not a nameless one.
    // Agent is null — the board is the only place an agent is chosen.
    const inherit = (await tabsRef.current?.activePaneCwd()) ?? null;
    const workspace = tabsRef.current?.activeWorkspacePath() ?? null;
    await tabsRef.current?.openFromPreset(
      preset.layout,
      resolveInheritedCwds(preset.layout, preset.cwds, inherit),
      {
        agent: null,
        ...(workspace !== null ? { workspacePath: workspace } : {}),
      },
    );
  }

  /** ⌘⇧S / menu: capture live layout into a new or existing preset. */
  async function handleSavePreset(
    target: SaveTarget,
    includeCwds: boolean,
  ): Promise<void> {
    const captured = await tabsRef.current?.captureActiveLayout();
    saveDialogOpen.value = false;
    if (!captured) {
      return;
    }
    const cwds =
      includeCwds && captured.cwds.some((cwd) => cwd !== null)
        ? captured.cwds
        : undefined;
    if (target.kind === "new") {
      savePreset({
        id: crypto.randomUUID(),
        name: target.name,
        layout: captured.layout,
        ...(cwds ? { cwds } : {}),
      });
      return;
    }
    const existing = presetsData.value.presets.find(
      (preset) => preset.id === target.id,
    );
    if (existing) {
      savePreset({
        id: existing.id,
        name: existing.name,
        layout: captured.layout,
        ...(cwds ? { cwds } : {}),
      });
    }
  }

  const sidebar =
    updatePreview?.sidebar ?? settings.value.tabBarPosition === "left";
  const selectTab = (index: number): void => {
    boardOpen.value = false;
    tabsRef.current?.selectTab(index);
  };
  const updateAction = (
    <UpdateAction
      view={updatePreview ?? updater.view.value}
      onDownload={() => {
        if (updatePreview === null) void updater.download();
      }}
      onInstall={() => {
        if (updatePreview === null) void updater.installAndRelaunch();
      }}
      onRelaunch={() => {
        if (updatePreview === null) void updater.relaunch();
      }}
    />
  );
  /**
   * Every overlay that covers the terminal grid. The Prompt Board targets the
   * FOCUSED pane, so it must not open — or stay open — while one of these
   * hides it. The keyboard path is already gated by `scope: "pane"`; a button
   * onClick is a direct call and needs this guard of its own.
   *
   * One function, read in two places: the render body (for `promptsDisabled`)
   * and INSIDE the effect below. It has to be a function, not a captured
   * boolean — see the effect's own comment.
   *
   * `usageOpen` belongs here for the same reason `settingsOpen` does: the
   * usage screen is full-bleed over the stage, so the pane the popover would
   * paste into is not on screen.
   */
  const overlayCoversPane = (): boolean =>
    boardOpen.value ||
    settingsOpen.value ||
    usageOpen.value ||
    editorRequest.value !== null ||
    saveDialogOpen.value;

  /**
   * Close an ALREADY OPEN popover the moment an overlay opens over it —
   * otherwise it keeps painting at z-100, above the Settings screen (z-35) it
   * is now covering nothing behind.
   *
   * The overlay signals are read INSIDE this callback on purpose.
   * `useSignalEffect` subscribes to exactly the signals its callback touches,
   * and it is created once; a boolean captured from the render body would make
   * this effect depend on `promptsOpen` alone, so opening Settings with ⌘,
   * would re-render App and never re-run this.
   */
  useSignalEffect(() => {
    if (promptsOpen.value && overlayCoversPane()) {
      promptsOpen.value = false;
    }
  });

  const closePrompts = (): void => {
    promptsOpen.value = false;
    tabsRef.current?.focusActive();
  };

  const togglePrompts = (): void => {
    if (promptsOpen.value) {
      closePrompts();
      return;
    }
    promptsOpen.value = true;
  };

  const promptPopover = promptsOpen.value ? (
    <PromptPopover
      capture={() =>
        capturePromptTarget(tabsRef.current?.activePaneId() ?? null)
      }
      loadAssets={(target) =>
        defaultPromptAssetsClient.list(target.agent ?? "", target.cwd)
      }
      inject={(target, text, autoSend) =>
        tabsRef.current?.injectIntoPane(target.paneId, text, {
          autoSend,
          expectedAgent: target.agent,
        }) ?? Promise.resolve("no-target" as const)
      }
      isAlive={(paneId) =>
        tabsRef.current?.allPaneIds().includes(paneId) ?? false
      }
      onClose={closePrompts}
    />
  ) : null;

  const chromeActions = (
    <ChromeActions
      settingsOpen={settingsOpen.value}
      expandActive={settings.value.focusExpand}
      onSplitRow={() => void tabsRef.current?.splitActive("row")}
      onSplitColumn={() => void tabsRef.current?.splitActive("column")}
      onClosePane={() => void tabsRef.current?.closePane()}
      onToggleExpand={() =>
        updateSettings({ focusExpand: !settings.value.focusExpand })
      }
      promptsOpen={promptsOpen.value}
      promptsDisabled={overlayCoversPane() || tabViews.value.length === 0}
      promptPopover={promptPopover}
      onTogglePrompts={togglePrompts}
      usageOpen={usageOpen.value}
      onToggleUsage={toggleUsage}
      onToggleSettings={toggleSettings}
      updateAction={updateAction}
    />
  );

  const maximizeMacWindow = (): void => {
    getCurrentWindow()
      .toggleMaximize()
      .catch((err: unknown) => {
        console.warn("toggleMaximize failed:", err);
      });
  };

  return (
    <DesktopChrome
      sidebar={sidebar}
      toolbar={chromeActions}
      sidebarNavigation={
        <WorkspaceSidebar
          onSelectTab={selectTab}
          onCloseTab={(index) => void tabsRef.current?.closeTab(index)}
          onNewTab={() => void tabsRef.current?.newTab()}
          onRenameTab={(index, name) => tabsRef.current?.renameTab(index, name)}
          onSetTabColor={(index, color) =>
            tabsRef.current?.setTabDotColor(index, color)
          }
          onFocusAttention={requestAttentionFocus}
        />
      }
      topTabs={
        <TabBar
          settingsOpen={settingsOpen.value}
          onSelectTab={selectTab}
          onCloseTab={(index) => void tabsRef.current?.closeTab(index)}
          onNewTab={() => void tabsRef.current?.newTab()}
          onSplitRow={() => void tabsRef.current?.splitActive("row")}
          onSplitColumn={() => void tabsRef.current?.splitActive("column")}
          onClosePane={() => void tabsRef.current?.closePane()}
          onRenameTab={(index, name) => tabsRef.current?.renameTab(index, name)}
          onSetTabColor={(index, color) =>
            tabsRef.current?.setTabDotColor(index, color)
          }
          expandActive={settings.value.focusExpand}
          onToggleExpand={() =>
            updateSettings({ focusExpand: !settings.value.focusExpand })
          }
          promptsOpen={promptsOpen.value}
          promptsDisabled={overlayCoversPane() || tabViews.value.length === 0}
          promptPopover={promptPopover}
          onTogglePrompts={togglePrompts}
          usageOpen={usageOpen.value}
          onToggleUsage={toggleUsage}
          onToggleSettings={toggleSettings}
          updateAction={updateAction}
          onFocusAttention={requestAttentionFocus}
        />
      }
      stage={
        <main class="stage">
          <div class="stage__tabs" ref={stagesRef} />
          {boardOpen.value ? (
            <OpenBoard
              canCancel={tabViews.value.length > 0}
              onCancel={() => {
                boardOpen.value = false;
                tabsRef.current?.focusActive();
              }}
              onOpen={(workspace, preset, agent) =>
                handleOpen(workspace, preset, agent)
              }
              onNewPreset={(workspace) => {
                editorRequest.value = { source: "board", workspace };
              }}
            />
          ) : null}
          {editorRequest.value !== null ? (
            <PresetEditor
              onCancel={() => {
                editorRequest.value = null;
              }}
              onCreate={(name, artifact) =>
                void handleEditorCreate(name, artifact)
              }
            />
          ) : null}
          {saveDialogOpen.value ? (
            <SavePresetDialog
              existing={presetsData.value.presets}
              onCancel={() => {
                saveDialogOpen.value = false;
              }}
              onSave={(target, includeCwds) =>
                void handleSavePreset(target, includeCwds)
              }
            />
          ) : null}
          <PersistErrorBar />
          <SettingsScreen open={settingsOpen.value} onClose={closePanel} />
          <UsageScreen open={usageOpen.value} onClose={closeUsage} />
        </main>
      }
      status={<StatusBar />}
      onMacTitlebarDoubleClick={maximizeMacWindow}
    />
  );
}
