import { useEffect, useRef } from "preact/hooks";
import { useSignal, useSignalEffect } from "@preact/signals";
import { listen, type UnlistenFn } from "../host/bridge";
import { getCurrentWindow, currentWindowLabel } from "../host/window-host";
import { ask, message } from "../host/dialog-host";
import { installQuitGuard } from "../lib/quit-guard";
import {
  confirmClose,
  QUIT_COPY,
  UPDATE_COPY,
  WINDOW_CLOSE_COPY,
  type ConfirmCopy,
} from "../terminal/close-guard";
import {
  flushSettingsSave,
  initSettings,
  settingsLoadState,
} from "../settings/settings-store";
import { defaultPtyClient } from "../terminal/pty-client";
import {
  detectedAgents,
  ensureAgentsDetected,
} from "../terminal/agent-detection-store";
import type { BootMode } from "../terminal/transfer-client";
import { applyThemeVars } from "../lib/theme-vars";
import { resolveCwds, type Preset } from "../lib/preset-schema";
import { resolveInheritedCwds } from "../terminal/tab-materialize";
import {
  openDockTab,
  revealDockTab,
  settings,
  updateSettings,
} from "../settings/settings-store";
import type { DockTab } from "../settings/settings-schema";
import { agentProcessMatchers, probeNames } from "../lib/agent-catalog";
import { resolveTheme } from "../settings/themes";
import { isShortcutAction } from "../terminal/keymap";
import { createTabManager, type TabManager } from "../terminal/tab-manager";
import { pingPane } from "../terminal/pane-ping";
import { activeTabIndex, tabViews } from "../terminal/tabs-store";
import {
  markLastUsed,
  presetsData,
  savePreset,
} from "../presets/presets-store";
import {
  recordWorkspaceOpen,
  removeWorkspaceRecents,
} from "../open-board/workspaces-store";
import type { AgentChoice } from "../lib/workspace-recents";
import {
  agentQuickPickerOpen,
  boardOpen,
  editorRequest,
  pathOpenRequest,
  persistError,
  promptsOpen,
  quickPickerWorkspace,
  reportPersistError,
  saveDialogOpen,
  settingsOpen,
} from "../chrome/events";
import {
  decideLinkTarget,
  externalAppLabel,
  resolveExternalApp,
} from "../lib/link-target";
import {
  ensureExternalAppsScanned,
  externalAppsScanned,
  installedExternalAppIds,
  installedExternalApps,
} from "../links/external-apps-store";
import { externalAppChoices } from "../links/external-app-choices";
import { ExternalAppButton } from "./toolbar/external-app-button";
import {
  available as externalAppsAvailable,
  openInApp,
  workspaceForPath,
} from "../host/external-apps-host";
import { AgentQuickPicker } from "./agent-quick-picker";
import { OpenBoard } from "../open-board/open-board";
import type { SessionEntry } from "../lib/session-history";
import { resumeSession } from "../sessions/resume-session";
import {
  deadProjects,
  probeSessionsSupport,
  refreshSessions,
  sessionsSupported,
} from "../sessions/sessions-store";
import { PresetEditor } from "../presets/preset-editor";
import {
  SavePresetDialog,
  type SaveTarget,
} from "../presets/save-preset-dialog";
import type { PresetArtifact } from "../presets/mock-model";
import { PersistErrorBar } from "../presets/persist-error-bar";
import { LoadError } from "./controls/load-error";
import { PromptPopover } from "../prompts/prompt-popover";
import { BrowserSurface } from "../browser/browser-surface";
import { defaultBrowserClient } from "../browser/browser-client";
import {
  activateBrowserSurface,
  browserSurfaceActive,
  closeBrowser,
  deactivateBrowserSurface,
  initBrowserBridge,
} from "../browser/browser-store";
import { installSessionTailSync } from "../terminal/session-tail-store";
import { composeSurfaceStrip } from "./stage-surface-strip";
import { capturePromptTarget } from "../prompts/inject";
import { defaultPromptAssetsClient } from "../prompts/prompt-assets-client";
import { TabBar } from "./tab-bar";
import { DeckToolbar } from "./toolbar/deck-toolbar";
// The sidebar slot's occupant. `RepositoryRail` and `WorkspaceSidebar` are
// deliberately still in the tree with their tests: each successive rail keeps
// its predecessor's callback contract, so swapping back is this one import and
// the JSX tag below it. `AgentRail` added one prop to that contract —
// `onFocusPane`, the pane-exact destination its chips and per-agent rows need —
// and, since 2026-08-16 (DL-27.10), no longer takes `onFocusAttention`: the
// pinned block whose count pressed it is gone, so a swap back re-wires that one
// prop to `requestAttentionFocus`.
import { AgentRail } from "./agent-rail";
import { StatusBar } from "./status-bar";
import { SettingsScreen } from "./settings/settings-screen";
import { UsageDockTab } from "./usage/usage-dock-tab";
import { runAttentionFocus } from "./attention-focus-coordinator";
import { getDesktopEnvironment } from "../lib/platform";
import {
  createUpdateController,
  type UpdateController,
} from "../updater/update-controller";
import { activeUpdateController } from "../updater/active-update-controller";
import { loadAppVersion } from "../updater/app-version";
import { UpdateAction } from "../updater/update-action";
// Host-agnostic by construction: it answers the Electron host, delegates to
// `tauri-updater-adapter.ts` under Tauri, and fails soft in a browser preview.
import {
  checkForUpdate,
  relaunchDeck,
} from "../updater/electron-updater-adapter";
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
import { buildOpenEditorRequest } from "../lib/editor-command";
import {
  activeFileTab,
  activeWorkspace,
  dirtyPaths,
  dockCollapseArmed,
  dockWidthLive,
  setActiveWorkspace,
} from "../files/file-surface-store";
import {
  createFileSurfaceController,
  type FileSurfaceController,
} from "../files/file-surface-controller";
import { ExplorerTab } from "../files/ui/explorer-tab";
import { SessionsDockTab } from "./sessions/sessions-dock-tab";
import { DockPanel } from "./dock/dock-panel";
import { SIDEBAR_TOOLS_HIDDEN, SidebarActions } from "./sidebar-actions";
import { DockToggle } from "./dock/dock-toggle";
import { useDockPresence } from "./dock/dock-presence";
import { availableDockTabs, resolveDockTab } from "./dock/dock-tab-registry";
import { StageSurface } from "../files/ui/stage-surface";
import { TabStrip } from "./tab-strip";
import { sidebarCollapseArmed, sidebarWidthLive } from "./sidebar-grip";
import { SIDEBAR_HIDDEN_WIDTH } from "./panel-resize";
import { applySidebarShell } from "./sidebar-shell";
import { SidebarFrameActions, SidebarToggle } from "./sidebar-toggle";
import {
  clearWindowRecord,
  flushSessionJournal,
  initSessionJournal,
  suspendSessionJournal,
} from "../terminal/session-journal";
import { restoreSession } from "../terminal/session-restore";
import {
  ensureRepositoriesScanned,
  repositoryScans,
} from "../repositories/repositories-store";
import {
  defaultDestinationPath,
  plainFolderDestination,
  worktreeDestinations,
  type QuickDestination,
} from "../repositories/worktree-destinations";
import { DesktopChrome } from "./desktop-chrome";
import {
  boardClosesAfterResume,
  bootOpensTheBoard,
  browserPanelObscured,
  closeSettingsPanel,
  dockPaintedOpen,
  dockToggleOnStage,
  liveRailAvailable,
  livePresetOpensATab,
  sidebarEffectivelyCollapsed,
  stripShowsTabs,
  toggleSettingsPanel,
  workspaceOrphanedByClose,
} from "./app-policy";
import { restoreDeps } from "./app-restore-deps";

export function App({ boot = { kind: "normal" } }: { boot?: BootMode } = {}) {
  const stagesRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<TabManager | null>(null);
  const updaterRef = useRef<UpdateController | null>(null);
  const fileControllerRef = useRef<FileSurfaceController | null>(null);
  if (fileControllerRef.current === null) {
    fileControllerRef.current = createFileSurfaceController({
      // `syncViews` never runs for a file-only transition (spec §2.3's
      // seam) — this is how the file store tells `TabManager` to re-derive
      // the strip's status without either module knowing about the other.
      onSurfacesChanged: () => tabsRef.current?.notifySurfacesChanged(),
    });
  }
  const fileController = fileControllerRef.current;
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
        // Installing an update is a FOURTH exit, which the quit/window-close/
        // tab-close set did not count: `app_relaunch` calls `app.exit(0)` and
        // never reaches `before-quit`, so main's dirty registry is never
        // consulted on this path. The renderer therefore has to supply the
        // unsaved-file list itself. It is empty until a file surface exists,
        // and correct the moment one does.
        return manager === null
          ? Promise.resolve(false)
          : confirmClose(
              manager.allPaneIds(),
              defaultPtyClient,
              UPDATE_COPY,
              dirtyPaths(),
            );
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
   * Focused pane's live cwd, resolved when the picker opens.
   *
   * It only exists to pick the picker's DEFAULT worktree: a pane the user has
   * `cd`'d into should preselect the worktree it is actually in, not the one
   * the tab was tagged with. Async, so it cannot be read during render.
   */
  const quickPickerCwd = useSignal<string | null>(null);

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
      focusAttention: (i) => {
        tabsRef.current?.focusNextAttention(i);
      },
    });
  };

  /**
   * The rail's pane-exact destination: an agent chip or a per-agent row names
   * ONE pane, and pressing it must land there
   * (`docs/specs/2026-08-16-agent-status-rail-design.md` §2.2).
   *
   * It walks the same preflight `requestAttentionFocus` does rather than a
   * second one — the overlay rules (a draft in `PresetEditor` blocks, a
   * full-window screen is dismissed by non-focusing set-state) are about
   * whether the pane the user is being sent to is on screen at all, and that
   * question does not change because the target was chosen by hand.
   *
   * Two differences, both deliberate. `hasCandidate` is unconditionally true:
   * the user picked a pane, so there IS something to focus even when that pane
   * carries no actionable attention — `hasActionableAttention` would turn a
   * click on a resting agent into a silent no-op. And the focus call is
   * `activateForAttention`, which activates exactly this pane and acks only
   * it, never `focusNextAttention`, which would pick the loudest pane in the
   * window instead of the one that was pressed.
   *
   * The 1.5s locator follows the focus in the same synchronous tick: the rail
   * has just dropped the user into a grid of identical panes, and without an
   * answer they have to re-find the thing they asked for (DL-18.11).
   */
  const focusRailPane = (index: number, paneId: number): void => {
    runAttentionFocus({
      tabIndex: index,
      hasCandidate: true,
      overlays: {
        board: boardOpen.value,
        settings: settingsOpen.value,
        presetEditor: editorRequest.value !== null,
        savePresetDialog: saveDialogOpen.value,
      },
      dismissBoard: () => {
        boardOpen.value = false;
      },
      dismissSettings: () => {
        settingsOpen.value = false;
      },
      focusAttention: () => {
        tabsRef.current?.activateForAttention(index, paneId);
        pingPane(paneId);
      },
    });
  };

  /**
   * Settings close: also returns focus to the active pane, matching Escape
   * and the gear button. Defined before the mount effect (like
   * `requestAttentionFocus` above) so `toggleSettings` below — passed into
   * `createTabManager` as the `onToggleSettings` seam for ⌘, and the menu's
   * "Settings…" item — captures this, not a stale reference. Delegates to
   * `closeSettingsPanel` (module scope, app-policy.ts) so App keeps owning
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
   * to `toggleSettingsPanel` (module scope, app-policy.ts) for the actual
   * open/close decision.
   */
  const toggleSettings = (): void => {
    toggleSettingsPanel(restoreFocusAfterSettings);
  };

  /**
   * Reveal a dock tab, and hand focus back to the pane only when the press
   * CLOSED the column. Shared by the toolbar, the menu, ⌘⇧U / ⌘⇧B and the
   * Settings screen's "see token usage" row.
   *
   * `restoreFocusAfterSettings` is reused verbatim rather than copied: "where
   * focus belongs once a surface stops holding it" has one answer (the Open
   * board if it is up, otherwise the active pane), and two copies would drift.
   */
  const revealDock = (tab: DockTab): void => {
    if (revealDockTab(tab)) {
      restoreFocusAfterSettings();
    }
  };
  const toggleUsage = (): void => revealDock("usage");

  /**
   * A history row's one action. The dock stays open: it displaces the
   * terminal grid rather than covering it (DL-19.1), so the tab this opens
   * is already on screen beside the row that opened it — closing the column
   * would take away the list the user is working through.
   *
   * `isDead` reads the store's liveness pass rather than re-checking here —
   * the row is already rendered unavailable for a missing directory, and this
   * is the second gate for the case where the directory disappeared between
   * the scan and the click.
   */
  const resumeSessionEntry = async (entry: SessionEntry): Promise<boolean> => {
    let resumed = false;
    try {
      resumed = await resumeSession(entry, {
        materialize: (intent) =>
          tabsRef.current?.materialize(intent) ?? Promise.resolve(false),
        customAgents: settings.value.customAgents,
        isDead: (cwd) => deadProjects.value.has(cwd),
      });
    } catch (err: unknown) {
      console.warn("Failed to resume session:", err);
    }
    // Say something. `resumeSession` answers false for an unusable session
    // ref, a directory that vanished between the scan and the click, and a
    // failed materialize — and discarding that answer made every one of
    // them look exactly like a button that does nothing, on a row the user
    // will simply click again.
    if (!resumed) {
      reportPersistError("Couldn't resume that session.");
    }
    return resumed;
  };

  // One cheap probe, once, at boot: `sessions_list` with a limit of 1 is a
  // stat pass plus at most two head reads on Electron, and an immediate
  // rejection on a host that has no handler for it. Its ONLY job is to decide
  // whether the toolbar control exists at all — the reply itself is discarded,
  // because a limit-1 answer is not a list and storing it would show one row
  // and call it the history.
  useEffect(() => {
    void probeSessionsSupport();
  }, []);

  // The rail's tails: a debounced sync that re-reads a pane's newest turn only
  // when that pane's state actually moved. Inert off Electron, and the install
  // returns its own disposer, so this is the whole wiring.
  useEffect(() => installSessionTailSync(), []);

  // The Open board's Sessions view reads the same store as the dock, so it
  // needs a scan even when the dock has never opened. Keyed on the board
  // opening: this is the earliest point that view can become reachable.
  useEffect(() => {
    if (boardOpen.value) {
      void refreshSessions();
    }
  }, [boardOpen.value]);

  useEffect(() => {
    const host = stagesRef.current;
    if (!host) {
      return;
    }
    const manager = createTabManager(host, undefined, {
      onRequestAttentionFocus: (tabIndex) => requestAttentionFocus(tabIndex),
      onToggleSettings: () => toggleSettings(),
      onToggleUsage: () => toggleUsage(),
      // The seam going live (Task 5): TabManager's `SurfaceStrip` consumer
      // (cycling, ⌘W routing, "last surface, not last tab", focus,
      // applySettings — src/terminal/tab-manager.ts:269) and the file
      // controller's production of it (file-surface-controller.ts) were both
      // already built and tested against a fake; this is the one line that
      // connects the real halves. Replaced `INERT_SURFACES`; since the
      // browser became a strip tab, the file controller is composed with the
      // browser surface here rather than passed bare — same seam, one more
      // occupant, TabManager untouched.
      surfaces: composeSurfaceStrip({
        files: fileController,
        client: defaultBrowserClient,
        onChanged: () => tabsRef.current?.notifySurfacesChanged(),
      }),
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
    // A normal window tries session restore before falling back to the board
    // (settings kill-switch permitting); an adopt window opens on the pane it
    // was created for and never shows the board at all (spec §9.2). Both
    // arms journal their own tabs afterward — the adopt window's `isMain:
    // false` so a later-detached pane folds into the main window's record on
    // the next boot.
    //
    // `init()` runs FIRST in both modes — it installs the PTY output and
    // exit listeners, and an adopted pane is dead without them.
    void manager
      .init()
      .then(async () => {
        const label = await currentWindowLabel();
        if (!bootOpensTheBoard(boot)) {
          const ok = await manager.adoptIntoNewTab(
            boot.kind === "adopt" ? boot.token : "",
          );
          if (!ok) {
            // Spec §13: a failed claim in a freshly booted window closes
            // that window — there is nothing else for it to show.
            void getCurrentWindow().close();
            return;
          }
          await initSessionJournal({
            capture: () => manager.captureSession(),
            windowLabel: label,
            isMain: false,
          });
          return;
        }
        // Restore BEFORE the journal starts writing: the journal's first
        // capture of an empty window must not clobber the record restore is
        // about to read.
        let restored = false;
        if (settings.value.restoreSessions) {
          restored = await restoreSession(
            restoreDeps({ manager, files: fileController }),
            label,
          ).catch((err: unknown) => {
            console.error("session restore failed:", err);
            return false;
          });
        }
        await initSessionJournal({
          capture: () => manager.captureSession(),
          windowLabel: label,
          isMain: true,
        });
        if (!restored) {
          boardOpen.value = true;
        }
      })
      .catch((err: unknown) => {
        // Without this an init failure is an unhandled rejection AND the
        // board never opens, so the window is simply blank with no way
        // forward. Journal init is skipped on this path — there is nothing
        // live yet to capture.
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

  // Installs the file-changed listener and the focus reconcile (spec §5) —
  // own effect, separate from the tab manager's mount above, since the two
  // lifecycles do not depend on each other (spec §2.3's seam).
  useEffect(() => {
    void fileController.init();
    return () => {
      fileController.dispose();
    };
  }, [fileController]);

  // Points the explorer panel and the strip's file segment at the active
  // terminal tab's workspace (`file-surface-store.ts`'s `setActiveWorkspace`
  // doc comment names App as this caller). Null for a tab with no workspace
  // (pre-0.2.2 restored, or a bare `newTab()`) — never a `$HOME` fallback
  // (spec §2.1).
  //
  // `tabViews.value[activeTabIndex.value]` is `undefined`, not a tab with a
  // null workspace, the moment a FILE surface takes the stage: `disposeTab`/
  // `removeEmptyTab` set `active = -1` and hand the stage to `surfaces` in
  // the same synchronous pass (spec §7, "last surface, not last tab"). Now
  // that `surfaces: fileController` is wired above, that pass runs for real
  // — and without this guard, this effect fires one render later and
  // clobbers `activeWorkspace` back to null, pulling the strip's file
  // segment and the panel's tree out from under the surface `disposeTab`
  // just activated. `setActiveWorkspace`'s own doc comment already says this
  // setter is "deliberately NOT called when the window runs out of terminal
  // tabs" — this is that rule enforced at its one call site.
  useSignalEffect(() => {
    const active = tabViews.value[activeTabIndex.value];
    if (active === undefined) {
      return;
    }
    setActiveWorkspace(active.workspacePath);
  });

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    // One builder per flow: the dialog title and OK label differ, so a
    // single shared `ask` closure would title a window-close dialog
    // "Quit Deck". `flush` is NOT built here — quit and close need opposite
    // journal behavior (see below), so each installs its own.
    const answering = (copy: ConfirmCopy) => ({
      ask: (text: string) =>
        ask(text, {
          title: copy.title,
          kind: "warning" as const,
          okLabel: copy.okLabel,
          cancelLabel: "Cancel",
        }),
    });
    installQuitGuard({
      quit: {
        ...answering(QUIT_COPY),
        // Quitting persists the journal so the next launch restores it.
        // Suspend FIRST: the window is going away, so a pane-exit signal
        // re-arming the debounce after the flush must not clobber the
        // flushed record mid-teardown (M1a). No resume needed.
        flush: async () => {
          suspendSessionJournal();
          await Promise.all([
            flushSettingsSave(),
            // `force`, because the line above suspended: without it this pair
            // cancelled the armed debounce and then wrote NOTHING, so quitting
            // within a second of opening or switching a tab dropped that
            // change from `session.json` entirely.
            flushSessionJournal({ force: true }),
          ]);
        },
        confirm: (requestId: number) => defaultPtyClient.confirmQuit(requestId),
        cancel: (requestId: number) => defaultPtyClient.cancelQuit(requestId),
      },
      close: {
        ...answering(WINDOW_CLOSE_COPY),
        // A deliberate window close CLEARS the record instead of flushing
        // it: persisting it here would write the very tabs being closed,
        // and the next boot's fold-in (or macOS re-`activate`) would
        // resurrect them as ghost tabs. Suspend FIRST: a pending debounced
        // write firing AFTER clearWindowRecord would re-write the record it
        // just cleared, resurrecting the same ghost tabs (M1b). No resume
        // needed — the window is going away.
        flush: async () => {
          suspendSessionJournal();
          await Promise.all([
            flushSettingsSave(),
            currentWindowLabel().then((label) => clearWindowRecord(label)),
          ]);
        },
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

  // Grabs arrive from the browser panel's page, not from a Deck surface, so
  // this listener is installed for the window's life rather than while some
  // component is mounted: the panel can be closed and reopened, and the pane a
  // grab lands in has nothing to do with the panel's own state.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void initBrowserBridge({
      client: defaultBrowserClient,
      // One write per committed main-frame navigation — what a cold open
      // restores (browser productization §3).
      onCommittedNavigation: (url) => updateSettings({ browserLastUrl: url }),
      // Wired, and deliberately not reached while `GRAB_PASTE_DISABLED` is up
      // in `browser-store.ts`: a grab stops at the clipboard (2026-08-16). The
      // seam stays here so flipping that constant back is the whole revert.
      target: {
        activePaneId: () => tabsRef.current?.activePaneId() ?? null,
        paste: async (paneId, text) => {
          // `autoSend: false`, always — a grab is text from a page Deck did
          // not write, and nothing from there submits itself to an agent.
          const outcome = await (tabsRef.current?.injectIntoPane(paneId, text, {
            autoSend: false,
            expectedAgent: null,
          }) ?? Promise.resolve("no-target" as const));
          return outcome === "pasted" || outcome === "sent";
        },
      },
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch((err: unknown) => {
        console.error("Failed to listen for browser grabs:", err);
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
    applyThemeVars(document.documentElement.style, resolveTheme(current));
  });

  // The stage's exclusion backstop: a file surface activating through ANY
  // path (explorer click, chip click, external open) pushes the browser off
  // the stage. The synchronous paths (composeSurfaceStrip, toggle-browser,
  // selectBrowserTab) already keep the invariant; this catches the file-side
  // entry points that never see the browser store. Runs a frame after the
  // signal flips (signals batch effects to animation frames), which is
  // acceptable: `setVisible` is an async IPC hop anyway.
  useSignalEffect(() => {
    if (activeFileTab.value !== null && browserSurfaceActive.value) {
      deactivateBrowserSurface(defaultBrowserClient);
      tabsRef.current?.notifySurfacesChanged();
    }
  });

  /**
   * Open workspace roots, most relevant first (design §3.1).
   *
   * The active tab's own workspace leads, because a ⌘+click lands in a pane of
   * the tab that is on the stage, and a repository opened twice (a worktree
   * beside its main checkout) must resolve to the one the user is looking at.
   * Duplicates and nulls are dropped: the list is a question sent over IPC,
   * not a rendering.
   */
  const workspaceRoots = (): string[] => {
    const active = tabsRef.current?.activeWorkspacePath() ?? null;
    const roots = new Set<string>();
    if (active !== null) {
      roots.add(active);
    }
    for (const tab of tabViews.value) {
      if (tab.workspacePath !== null) {
        roots.add(tab.workspacePath);
      }
    }
    return [...roots];
  };

  /**
   * A path an agent printed, activated by ⌘+click (design §3).
   *
   * `link-provider.ts` raises the intent and this is the only place that
   * decides what happens to it — which is what keeps the provider from
   * importing the file layer and `TabManager` from learning what a file is.
   * The decision itself is pure (`decideLinkTarget`); everything here is the
   * async that surrounds it: ask main which workspace holds the file, then
   * open it in Deck, in the selected editor, or in the selected app.
   *
   * The request is cleared before the await, so a second click during a slow
   * `workspace_for_path` raises a fresh one rather than being read twice.
   */
  useSignalEffect(() => {
    const request = pathOpenRequest.value;
    if (request === null) {
      return;
    }
    pathOpenRequest.value = null;
    const roots = workspaceRoots();
    void (async () => {
      const [root] = await Promise.all([
        workspaceForPath(request.path, roots),
        // The apps are scanned lazily: this is usually already answered (the
        // toolbar asks on mount), and on the first click of a session it is
        // the one hop that decides whether the fallback app exists at all.
        ensureExternalAppsScanned(),
      ]);
      const target = decideLinkTarget({
        path: request.path,
        line: request.line,
        column: request.column,
        workspaceRoot: root,
        appId: resolveExternalApp(
          settings.value.externalAppId,
          installedExternalAppIds(),
          // A host with no `external_apps` channel is not an empty machine:
          // on Tauri the click has to keep reaching `open_editor` (design §5).
          externalAppsAvailable,
        ),
      });
      switch (target.kind) {
        case "deck":
          // A preview tab, matching the tree's single click (DL/file-explorer
          // spec §4.1): the first edit promotes it, so a link followed and
          // abandoned does not accumulate tabs.
          await fileController.openFile(
            target.workspacePath,
            target.path,
            false,
            { line: target.line, column: target.column },
          );
          return;
        case "editor": {
          // Through the SAME builder the link provider used before this work,
          // so the request `open_editor` validates has not changed shape —
          // which is what keeps `src-tauri/src/links.rs` a valid twin.
          const request = buildOpenEditorRequest(
            target.editor,
            "",
            target.path,
            target.line,
            target.column,
          );
          if (request === null) {
            return;
          }
          await defaultLinkClient
            .openEditor(request)
            .catch((error: unknown) => {
              reportPersistError(`Couldn't open the editor: ${String(error)}`);
            });
          return;
        }
        case "app":
          await openInApp({
            appId: target.appId,
            path: target.path,
            isDirectory: false,
            line: target.line,
            column: target.column,
          }).catch((error: unknown) => {
            reportPersistError(
              `Couldn't open ${externalAppLabel(target.appId)}: ${String(error)}`,
            );
          });
          return;
        case "unavailable":
          reportPersistError(target.reason);
      }
    })();
  });

  // The agent probe, started at boot rather than when a panel that needs it is
  // already on screen: discovery spends an interactive login shell and measured
  // ~1.1s here (see `agent-detection-store.ts`), so a picker that probes on
  // open offers "Shell only" for a second first. Reading `customAgents` also
  // re-runs this when settings land, and the store's own freshness window is
  // what stops an ordinary settings broadcast from paying for a second probe.
  useSignalEffect(() => {
    void ensureAgentsDetected(probeNames(settings.value.customAgents));
  });

  // The external-app scan, started at boot for the same reason: the toolbar's
  // split-button is ABSENT until it answers (design §4.1), and a control that
  // appears a second after the window does reads as a glitch. A handful of
  // `stat` calls plus one icon read per hit, so unlike the agent probe it
  // spends no shell.
  useEffect(() => {
    void ensureExternalAppsScanned();
  }, []);

  // Refreshes whenever AgentQuickPicker opens (or the declared set changes
  // while it is up) — same reasoning as the Open board's own detect effect:
  // adding an agent in Settings and coming straight back has to show it
  // without a relaunch. The cached list is what the panel paints; this open is
  // only the moment the refresh behind it is asked for.
  useSignalEffect(() => {
    if (!agentQuickPickerOpen.value) {
      return;
    }
    const customAgents = settings.value.customAgents;
    let cancelled = false;
    // The destination list rides the SAME open: the rail has usually scanned
    // this repository already (the store caches by path, and one scan answers
    // for every worktree of a repository), so this is normally a no-op that
    // only pays on a workspace the rail has not reached yet.
    const target = quickPickerWorkspace.value;
    const workspacePath =
      target ?? tabsRef.current?.activeWorkspacePath() ?? null;
    if (workspacePath !== null) {
      ensureRepositoriesScanned([workspacePath]);
    }
    // The focused pane's cwd only answers for an open that means "here". A
    // rail launch (DL-27.18) names its own project, and reading the active
    // pane would preselect a worktree of a DIFFERENT repository.
    if (target === null) {
      void tabsRef.current?.activePaneCwd().then((cwd) => {
        if (!cancelled) {
          quickPickerCwd.value = cwd;
        }
      });
    } else {
      quickPickerCwd.value = null;
    }
    void ensureAgentsDetected(probeNames(customAgents));
    return () => {
      cancelled = true;
    };
  });

  /**
   * Worktrees the picker can open into.
   *
   * Read during render so the component re-renders when the scan lands (a
   * signal read in the render body subscribes). Empty means "no destination
   * row": a plain folder, no tab at all, or a host with no `git_repository`
   * channel — which is every Tauri build, since that command was never
   * written for the frozen host.
   */
  const quickPickerDestinations = (): readonly QuickDestination[] => {
    const target = quickPickerWorkspace.value;
    const workspacePath =
      target ?? tabsRef.current?.activeWorkspacePath() ?? null;
    if (workspacePath === null) {
      return [];
    }
    const worktrees = worktreeDestinations(
      repositoryScans.value.get(workspacePath),
    );
    // A rail launch always states its destination, even when git knows
    // nothing about the folder: the panel's no-destination copy says "Runs in
    // this workspace", which is a lie about a project the user pressed rather
    // than the one on the stage.
    return worktrees.length === 0 && target !== null
      ? [plainFolderDestination(target)]
      : worktrees;
  };

  /**
   * Live pane cwd first, then the tab's workspace — see `quickPickerCwd`.
   * A rail launch skips both: its own project is the preference, and the
   * pane cwd is held null for exactly that reason.
   */
  const quickPickerDefaultDestination = (): string | null =>
    defaultDestinationPath(
      quickPickerDestinations(),
      quickPickerWorkspace.value,
      quickPickerCwd.value,
      tabsRef.current?.activeWorkspacePath() ?? null,
    );

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
  const railAvailable = liveRailAvailable(tabViews.value.length);
  const effectiveSidebarCollapsed = (): boolean =>
    sidebarEffectivelyCollapsed({
      liveTabCount: tabViews.value.length,
      savedCollapsed: settings.value.sidebarCollapsed,
      dragCollapsed:
        sidebarWidthLive.value === null ? null : sidebarCollapseArmed.value,
    });
  const sidebarPaintWidth = (): number =>
    liveRailAvailable(tabViews.value.length)
      ? (sidebarWidthLive.value ??
        (settings.value.sidebarCollapsed
          ? SIDEBAR_HIDDEN_WIDTH
          : settings.value.sidebarWidth))
      : SIDEBAR_HIDDEN_WIDTH;
  // Written to `:root`, not handed to the shell as props — see
  // `sidebar-shell.ts` for the defect that forces it and the evidence behind
  // it. Reading the signals INSIDE the effect is what subscribes it, so a
  // drag and a settings flip both reach the column.
  useSignalEffect(() => {
    applySidebarShell(document.documentElement, {
      width: sidebarPaintWidth(),
      collapsed: effectiveSidebarCollapsed(),
      sidebar,
    });
  });
  const toggleSidebarCollapsed = (): void => {
    // Straight at the setting, unlike `toggle-explorer`: the explorer's chord
    // owns a focus guard because that panel can take focus off a pane, and a
    // second unguarded way in would bypass it. Collapsing the sidebar covers
    // no pane and moves no focus — the same reasoning `focusExpand`'s toolbar
    // button already runs on.
    updateSettings({ sidebarCollapsed: !settings.value.sidebarCollapsed });
  };
  const selectTab = (index: number): void => {
    boardOpen.value = false;
    tabsRef.current?.selectTab(index);
  };
  /**
   * The chrome's one tab-close entry point (RepositoryRail's "Close
   * workspace" row and TabBar's close button) — captures
   * `workspaceOrphanedByClose` BEFORE the close (indexes shift once
   * `tabViews` updates), then closes the file surface left behind, if any.
   * `closeWorkspace` has its own dirty guard (one `confirmDiscard` for the
   * whole workspace), so this never asks twice for the same files. `closeTab`
   * still runs the terminal-side busy guard on its own; nothing here bypasses
   * it.
   *
   * ⌘⇧W (`close-tab`) does NOT go through this — that action runs entirely
   * inside `TabManager`, which has no notion of a file surface's workspace.
   * Flagged in the report rather than fixed here: closing it means widening
   * `SurfaceStrip`, out of this task's file scope.
   */
  const closeTab = async (index: number): Promise<void> => {
    const orphaned = workspaceOrphanedByClose(tabViews.value, index);
    await tabsRef.current?.closeTab(index);
    if (orphaned !== null) {
      await fileController.closeWorkspace(orphaned);
    }
  };
  /**
   * The browser chip's select: the browser takes the stage, the file surface
   * steps back — App is the one module that sees both stores, so this is
   * where the "exactly one surface owns the stage" rule runs for chip clicks
   * (TabManager-initiated paths run it inside `composeSurfaceStrip`).
   * `notifySurfacesChanged` mirrors the file controller's `onSurfacesChanged`
   * wiring: a store-signal transition is invisible to `syncViews` otherwise.
   */
  const selectBrowserTab = (): void => {
    if (browserSurfaceActive.value) {
      return;
    }
    fileController.deactivate();
    activateBrowserSurface();
    tabsRef.current?.notifySurfacesChanged();
  };
  /** The browser chip's ✕: the chip leaves the strip, the page is kept. */
  const closeBrowserTab = (): void => {
    void closeBrowser(defaultBrowserClient);
    tabsRef.current?.notifySurfacesChanged();
    tabsRef.current?.focusActive();
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
   * The dock is deliberately absent: it is a column of the stage (DL-19.1),
   * so the pane a popover would paste into is still on screen beside it.
   * Only surfaces that COVER the pane belong here.
   */
  const overlayCoversPane = (): boolean =>
    boardOpen.value ||
    settingsOpen.value ||
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

  /**
   * Everything that must hide the browser surface's native view.
   *
   * Wider than `overlayCoversPane()` on purpose: that one answers "is the
   * FOCUSED PANE covered", which is about whether a pane-scoped action still
   * makes sense. This one answers "is any DOM pixel trying to paint over the
   * stage", because a native view wins that contest no matter the z-index.
   */
  const panelObscured = (): boolean =>
    browserPanelObscured({
      overlayCoversPane: overlayCoversPane(),
      // `agentQuickPickerOpen` is deliberately here and NOT in
      // `overlayCoversPane()`: it is a modal on the same scrim as the other two
      // (`openOverlayRanks()` already ranks it as one), so it paints over the
      // stage and the native view must go — but it opens a NEW tab rather than
      // covering the focused one, so the pane-scoped question that
      // `overlayCoversPane()` answers is a different one. Missing from here
      // until 2026-08-16, which meant ⌘T over an open browser tab drew the
      // picker underneath the `WebContentsView`.
      agentQuickPickerOpen: agentQuickPickerOpen.value,
      promptsOpen: promptsOpen.value,
      persistErrorVisible: persistError.value !== null,
      settingsLoadError: settingsLoadState.value.status === "error",
    });

  /** Live drag width while resizing, the persisted setting otherwise. */
  const dockWidth = (): number =>
    dockWidthLive.value ?? settings.value.dockWidth;

  /**
   * The tab the dock actually shows: the stored one, re-checked against
   * host support on every read. A profile carrying `"sessions"` that moves
   * to a host with no `sessions_list` must not paint an empty column, and
   * resolving here rather than rewriting the setting means moving back to a
   * host that has it restores the user's own choice.
   */
  const dockTab = (): DockTab =>
    resolveDockTab(settings.value.dockTab, sessionsSupported.value);

  /** Why Prompts cannot run, or null — one answer, read by both mounts. */
  const promptsUnavailable = (): string | null =>
    tabViews.value.length === 0
      ? "no pane to paste into"
      : overlayCoversPane()
        ? "a surface is covering the pane"
        : null;

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
        capturePromptTarget(
          tabsRef.current?.activePaneId() ?? null,
          defaultPtyClient,
          agentProcessMatchers(settings.value.customAgents),
        )
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

  /**
   * The rail's footer of window actions (DL §28). Built here beside
   * `chromeActions` because it is the same job: `App` owns Prompts and
   * Settings, and both layouts must show the same state for them — the rail
   * in sidebar mode, the toolbar's `More` menu in top-tab mode.
   */
  const railActions = (
    <SidebarActions
      // Every callback here OPENS and stops. Pressing the row of something
      // already on screen is a no-op, so none of them can be the thing that
      // puts a surface away — that stays with each surface's own control.
      onOpenBrowser={() => {
        if (!browserSurfaceActive.value) {
          tabsRef.current?.runAction("toggle-browser");
        }
      }}
      onOpenUsage={() => openDockTab("usage")}
      sessionsAvailable={sessionsSupported.value}
      onOpenSessions={() => openDockTab("sessions")}
      promptsOpen={promptsOpen.value}
      promptsUnavailable={promptsUnavailable()}
      promptPopover={promptPopover}
      onOpenPrompts={() => {
        if (!promptsOpen.value) {
          togglePrompts();
        }
      }}
      onOpenSettings={() => {
        if (!settingsOpen.value) {
          toggleSettings();
        }
      }}
    />
  );

  // One element, both layouts: DesktopChrome mounts it in the frame in
  // sidebar mode, TabBar mounts the same element in top-tab mode. Building it
  // once is what keeps the two mounts from drifting apart.
  /**
   * The external-app split-button (new DL-23.11). Built here rather than in
   * `DeckToolbar` because it needs two things the toolbar has no access to:
   * the installed-app scan, and the workspace the active tab is on — which is
   * what the icon half opens. Absent entirely where nothing is installed or
   * the host cannot answer, which is every Tauri build (design §4.1).
   */
  const externalAppControl = (
    <ExternalAppButton
      // Installed apps only, and only once the scan has answered — the
      // catalog fallback inside `externalAppChoices` exists for the SETTINGS
      // picker, which has to stay usable on a host that cannot answer. Here an
      // empty list means the control does not render at all, which is both the
      // Tauri rule (design §4.1) and what keeps the button from flashing ten
      // unusable rows for the frame before the scan lands.
      choices={
        externalAppsAvailable && externalAppsScanned.value
          ? externalAppChoices(installedExternalApps.value, true)
          : []
      }
      selected={settings.value.externalAppId}
      workspacePath={activeWorkspace.value}
      onOpen={() => {
        const target = activeWorkspace.value;
        if (target === null) {
          return;
        }
        void openInApp({
          appId: settings.value.externalAppId,
          path: target,
          // The button always names a FOLDER, which is what selects each app's
          // folder rule — a git client resolves it to its repository, a
          // terminal opens it, an editor opens the project.
          isDirectory: true,
          line: 1,
          column: 1,
        }).catch((error: unknown) => {
          reportPersistError(
            `Couldn't open ${externalAppLabel(settings.value.externalAppId)}: ${String(error)}`,
          );
        });
      }}
      onSelect={(externalAppId) => {
        // The same one field Settings writes (design §5), so the chrome and
        // Settings cannot disagree about what a path opens in.
        updateSettings({ externalAppId });
      }}
    />
  );

  const chromeActions = (
    <DeckToolbar
      externalApp={externalAppControl}
      compact={!sidebar}
      browserActive={browserSurfaceActive.value}
      settingsOpen={settingsOpen.value}
      expandActive={settings.value.focusExpand}
      onToggleBrowser={() => tabsRef.current?.runAction("toggle-browser")}
      onSplitRow={() => void tabsRef.current?.splitActive("row")}
      onSplitColumn={() => void tabsRef.current?.splitActive("column")}
      onClosePane={() => void tabsRef.current?.closePane()}
      onToggleExpand={() =>
        updateSettings({ focusExpand: !settings.value.focusExpand })
      }
      promptsOpen={promptsOpen.value}
      promptsUnavailable={promptsUnavailable()}
      promptPopover={promptPopover}
      onTogglePrompts={togglePrompts}
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
  const dockState = {
    boardOpen: boardOpen.value,
    dockOpen: settings.value.dockOpen,
  };
  // A drag past the floor closes the column UNDER THE POINTER, the way the
  // navigation sidebar's seam always has (2026-08-19): while a drag is in
  // flight the armed flag answers instead of the setting, and the setting is
  // written on release. `dockDragging` is also what holds the mount open —
  // pointer capture survives the panel going off-stage, but not unmounting.
  const dockDragging = dockWidthLive.value !== null;
  const dockPainted = dockPaintedOpen({
    ...dockState,
    dragCollapsed: dockDragging ? dockCollapseArmed.value : null,
  });
  // The column outlives its own close by the length of DL §7's slide-over, so
  // it can animate out instead of blinking away. `mounted` is what decides
  // whether the panel is in the DOM; `entered` is what it is painted at.
  const dockPresence = useDockPresence(dockPainted, dockDragging);
  // The chrome carries the dock's hide control only while the column is gone
  // — an open panel holds its own at its outer edge (DL-19.3, amended). Gated
  // on the MOUNT, not the setting: during the slide-out the panel still holds
  // its own control, and the two must never be on screen together.
  const stripDockToggle = dockToggleOnStage(dockState) && !dockPresence.mounted;

  return (
    <DesktopChrome
      sidebar={sidebar}
      sidebarWidth={railAvailable ? sidebarPaintWidth() : undefined}
      onSidebarWidthChange={
        railAvailable
          ? (width) => updateSettings({ sidebarWidth: width })
          : undefined
      }
      onSidebarCollapsedChange={
        railAvailable
          ? (value) => updateSettings({ sidebarCollapsed: value })
          : undefined
      }
      sidebarToggle={
        railAvailable && !effectiveSidebarCollapsed() ? (
          <SidebarFrameActions
            collapsed={false}
            onToggle={toggleSidebarCollapsed}
            onOpenWorkspace={() => {
              boardOpen.value = true;
            }}
            newPaneDrop={{
              // Read at pointer time, so the rects belong to whatever tab is on
              // the stage right now rather than to the one that was there when
              // the rail last rendered.
              //
              // `panelObscured()`, not `overlayCoversPane()`: the question here
              // is the native view's question — "is anything painting over the
              // stage" — because the rail keeps its column while the board, the
              // full-bleed Settings screen and every modal cover the panes.
              // Reporting no targets is how the drag goes inert; a pane docked
              // behind an opaque screen is the ⌘T-under-`WebContentsView` bug in
              // another shape.
              slotRects: () =>
                panelObscured()
                  ? []
                  : (tabsRef.current?.activeSlotRects() ?? []),
              onDrop: (paneId, edge) => {
                void tabsRef.current?.dropAgentPane(paneId, edge);
              },
            }}
          />
        ) : null
      }
      // Sidebar layout keeps the frame row for the traffic lights and the
      // sidebar's leading controls: hide first, then `New` (DL-18.9). The
      // feature toolbar remains on the stage strip's trailing end, so it is
      // not squeezed by the column's width and does not fold into `More` the
      // moment that column narrows. Top-tab mode is unchanged: `TabBar` still
      // mounts the same element.
      toolbar={sidebar ? null : chromeActions}
      sidebarNavigation={
        railAvailable ? (
          <AgentRail
            // Hidden on the owner's ask (2026-08-17); `More` carries these rows
            // in both layouts while the flag is on. See `SIDEBAR_TOOLS_HIDDEN`.
            footer={SIDEBAR_TOOLS_HIDDEN ? undefined : railActions}
            onSelectTab={selectTab}
            onCloseTab={(index) => void closeTab(index)}
            onFocusPane={focusRailPane}
            onNewTabIn={(workspacePath) => {
              // DL-27.18: the same panel ⌘T raises, with the destination
              // decided by which project header was pressed.
              quickPickerWorkspace.value = workspacePath;
              agentQuickPickerOpen.value = true;
            }}
            // A remembered header's close: forget the folder by dropping its
            // history entries; the rail re-derives from `workspacesData`.
            onRemoveWorkspace={removeWorkspaceRecents}
            fileController={fileController}
          />
        ) : null
      }
      topTabs={
        <TabBar
          onSelectTab={selectTab}
          onCloseTab={(index) => void closeTab(index)}
          onNewTab={() => void tabsRef.current?.newTab()}
          toolbar={chromeActions}
          fileController={fileController}
          onSelectBrowser={selectBrowserTab}
          onCloseBrowser={closeBrowserTab}
          trailing={
            // Only while the column is gone: an open panel carries its own
            // hide control at its outer edge (`DockPanel`), the way the
            // sidebar's rides the frame row.
            stripDockToggle ? (
              <DockToggle
                open={false}
                onToggle={() => tabsRef.current?.runAction("toggle-dock")}
              />
            ) : null
          }
        />
      }
      stage={
        <main
          class={`stage ${
            // The MOUNT, not the setting: the terminal grid keeps its inset
            // until the column has finished sliding out, so the panes resize
            // once — after the animation — instead of jumping out from under
            // a panel that is still on screen. DURING a drag the mount is held
            // open on purpose, so the painted state answers instead and the
            // terminals reclaim the space the moment the gesture arms.
            (dockDragging ? dockPainted : dockPresence.mounted)
              ? "stage--dock"
              : ""
          } ${sidebar ? "stage--strip" : ""}`}
          // One number, two consumers: the panel's own column and the inset
          // that keeps the terminal grid clear of it. A drag updates the
          // live signal, so both move together instead of the terminals
          // catching up when the pointer is released.
          style={{
            "--dock-w": `${dockWidth()}px`,
          }}
        >
          {/* DL-18.6: sidebar mode's half of the frame row. The stage spans
              row 1 of column 2, which used to be empty — the tab strip
              occupies it, so the same chip component exists in both layouts
              and the row keeps its single-row count (DL-18.1). Its sidebar
              projection follows the active worktree; top-tab mode keeps the
              global strip inside `TabBar`, so nothing else mounts here. */}
          {sidebar ? (
            // Drag region for the same reason `.tabbar` is one: this is chrome
            // now, not stage. `[data-tauri-drag-region]`'s own rule exempts
            // buttons and `role="tab"`, so every chip and the add button stay
            // clickable without listing them here (styles.css).
            <div class="stage__strip" data-tauri-drag-region>
              {/* DL-18.9: while the column is shown its hide control sits in
                  the frame row beside the traffic lights. A HIDDEN column has
                  no frame row, so the control moves here — first in the strip,
                  after the inset that keeps it clear of the OS buttons — and
                  is the way back out. */}
              {railAvailable && effectiveSidebarCollapsed() ? (
                <SidebarToggle collapsed onToggle={toggleSidebarCollapsed} />
              ) : null}
              {/* The window's controls survive a full-window surface; the
                  chips do not — see `stripShowsTabs`. The strip itself stays
                  mounted either way, because the row it occupies is the frame
                  row while the sidebar is hidden. */}
              {stripShowsTabs({
                boardOpen: boardOpen.value,
                settingsOpen: settingsOpen.value,
              }) ? (
                <TabStrip
                  onSelectTab={selectTab}
                  onCloseTab={(index) => void closeTab(index)}
                  onNewTab={() => void tabsRef.current?.newTab()}
                  fileController={fileController}
                  onSelectBrowser={selectBrowserTab}
                  onCloseBrowser={closeBrowserTab}
                  scopeToActiveRepository
                />
              ) : null}
              {/* The feature toolbar's sidebar-mode mount (2026-08-16). It
                  rides the strip's trailing end rather than the frame row so
                  the sidebar's width stops deciding how many of its controls
                  are visible. One element, both layouts, still — `TabBar`
                  mounts this same `chromeActions` in top-tab mode. */}
              <div class="stage__strip-actions">{chromeActions}</div>
              {/* DL-18.9's arrangement, applied to the other edge: while the
                  dock is SHOWN its hide control rides the dock's own header
                  (`DockPanel`), and only a CLOSED column hands its way back
                  out to the strip — a closed column cannot hold its own
                  control. So this mount is the closed half, and `showDock`
                  is what tells the two apart. First in the strip brings the
                  sidebar back, last in it brings the dock back; each control
                  still sits on the side of the thing it acts on. */}
              {stripDockToggle ? (
                <DockToggle
                  open={false}
                  onToggle={() => tabsRef.current?.runAction("toggle-dock")}
                />
              ) : null}
            </div>
          ) : null}
          <div class="stage__tabs" ref={stagesRef} />
          {/* The document, on the stage rather than parked in the explorer
              panel (spec §4.2). It COVERS `.stage__tabs` instead of
              unmounting it: the terminal grid keeps its size, so taking the
              stage back costs no xterm reflow and no PTY resize round-trip.
              Deliberately NOT gated on `dockOpen`, unlike the old preview
              block that inherited that gate from the panel around it — an
              open document is not part of the file tree, and ⌘⇧B should not
              throw an editor away. `StageSurface` owns the condition so it is
              testable without an `<App>` harness. */}
          <StageSurface controller={fileController} />
          {/* The browser, on the stage the same way the document is — its
              own component owns the mount condition (browser-surface.tsx).
              The native view paints above every DOM layer, so "something
              floats over the stage" has to reach the host as a hide — CSS
              cannot put anything in front of it. `overlayCoversPane()` alone
              was not enough, and the gap was not cosmetic: the Prompt Board
              popover is `right: 0` and 320px wide, so it opens INSIDE the
              surface and the user types into something they cannot see. */}
          <BrowserSurface hidden={panelObscured()} onClose={closeBrowserTab} />
          {/* Gated on the `dockOpen` setting. The column hosts three
              surfaces since 2026-08-16, so `App` picks the body — that is
              what keeps `DockPanel` from importing every feature it can
              show. `resolveDockTab` re-checks host support on every render:
              a profile that stored "sessions" and then moved to a host with
              no `sessions_list` must not paint an empty column. */}
          {dockPresence.mounted ? (
            <DockPanel
              entered={dockPresence.entered}
              tabs={availableDockTabs(sessionsSupported.value)}
              activeTab={dockTab()}
              onSelectTab={(tab) => updateSettings({ dockTab: tab })}
              width={dockWidth()}
              onWidthChange={(width) => updateSettings({ dockWidth: width })}
              // Through the action for the same reason the toolbar button is
              // (see `chromeActions` above): the chord path owns the focus
              // guard, so the drag-past-the-floor gesture must not flip
              // `dockOpen` on its own.
              onClose={() => tabsRef.current?.runAction("toggle-dock")}
            >
              {dockTab() === "explorer" ? (
                <ExplorerTab
                  controller={fileController}
                  workspacePath={activeWorkspace.value}
                />
              ) : dockTab() === "usage" ? (
                <UsageDockTab />
              ) : (
                <SessionsDockTab
                  onResume={(entry) => void resumeSessionEntry(entry)}
                />
              )}
            </DockPanel>
          ) : null}
          {boardOpen.value ? (
            <OpenBoard
              canBrowseSessions={sessionsSupported.value}
              openWorkspacePaths={
                new Set(
                  tabViews.value.flatMap((tab) =>
                    tab.workspacePath === null ? [] : [tab.workspacePath],
                  ),
                )
              }
              onResumeSession={async (entry) => {
                const resumed = await resumeSessionEntry(entry);
                if (boardClosesAfterResume(resumed)) {
                  boardOpen.value = false;
                }
                return resumed;
              }}
              canCancel={tabViews.value.length > 0}
              onCancel={() => {
                boardOpen.value = false;
                tabsRef.current?.focusActive();
              }}
              onOpen={(workspace, preset, agent) =>
                handleOpen(workspace, preset, agent)
              }
            />
          ) : null}
          {agentQuickPickerOpen.value ? (
            <AgentQuickPicker
              detected={detectedAgents.value}
              customAgents={settings.value.customAgents}
              disabledAgents={settings.value.disabledAgents}
              destinations={quickPickerDestinations()}
              initialDestination={quickPickerDefaultDestination()}
              onSelect={(agentId, destination, profileId) => {
                // Closes immediately (the "quick" in AgentQuickPicker) —
                // `materialize`'s own selectTab already focuses the new
                // pane on success, and a failure is surfaced through the
                // shared chrome bar rather than keeping the picker up.
                agentQuickPickerOpen.value = false;
                // The panel's own choice wins; the rail's target is the
                // fallback for a project whose destination row was omitted.
                const target = destination ?? quickPickerWorkspace.value;
                quickPickerWorkspace.value = null;
                void tabsRef.current
                  ?.openQuickAgent(agentId, target, profileId)
                  .then((ok) => {
                    if (!ok) {
                      reportPersistError("Could not open a new tab.");
                    }
                  });
              }}
              onCancel={() => {
                agentQuickPickerOpen.value = false;
                quickPickerWorkspace.value = null;
                tabsRef.current?.focusActive();
              }}
              onManageAgents={() => {
                agentQuickPickerOpen.value = false;
                quickPickerWorkspace.value = null;
                settingsOpen.value = true;
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
          {settingsLoadState.value.status === "error" && !settingsOpen.value ? (
            <div class="settings-load-alert">
              <LoadError
                message={settingsLoadState.value.message}
                onRetry={() => void initSettings()}
              />
            </div>
          ) : null}
          <PersistErrorBar />
          <SettingsScreen open={settingsOpen.value} onClose={closePanel} />
        </main>
      }
      // Off by default since 2026-08-16 (`showStatusBar`): the row is pure
      // readout, so the window keeps its height instead.
      status={settings.value.showStatusBar ? <StatusBar /> : null}
      onMacTitlebarDoubleClick={maximizeMacWindow}
    />
  );
}
