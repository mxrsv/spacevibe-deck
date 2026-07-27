import { useEffect, useRef } from "preact/hooks";
import { useSignalEffect } from "@preact/signals";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { installQuitGuard } from "../lib/quit-guard";
import { confirmClose, QUIT_COPY } from "../terminal/close-guard";
import { flushSettingsSave } from "../settings/settings-store";
import { defaultPtyClient } from "../terminal/pty-client";
import { deriveChromeColors } from "../lib/derive-colors";
import { resolveCwds, type Preset } from "../lib/preset-schema";
import { resolveInheritedCwds } from "../terminal/tab-materialize";
import { settings, updateSettings } from "../settings/settings-store";
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
  saveDialogOpen,
  settingsOpen,
} from "../chrome/events";
import { OpenBoard } from "../open-board/open-board";
import { PresetEditor } from "../presets/preset-editor";
import {
  SavePresetDialog,
  type SaveTarget,
} from "../presets/save-preset-dialog";
import type { PresetArtifact } from "../presets/mock-model";
import { PersistErrorBar } from "../presets/persist-error-bar";
import { TabBar } from "./tab-bar";
import { ChromeActions } from "./chrome-actions";
import { WorkspaceSidebar } from "./workspace-sidebar";
import { StatusBar } from "./status-bar";
import { SettingsPanel } from "./settings-panel";
import { runAttentionFocus } from "./attention-focus-coordinator";

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
 * OPENING (the `else` branch) is blocked while a PresetEditor/
 * SavePresetDialog draft is up. Escape-stacking investigation: that draft's
 * modal-scrim sits at z-index 40, Settings' own panel at z-index 20
 * (styles.css) — opening Settings underneath it would be invisible and
 * unreachable, and `SettingsPanel`'s own mount-focus effect
 * (settings-panel.tsx) would steal DOM focus away from the draft, so a
 * later Escape only closes the (invisible) Settings panel and orphans focus
 * behind a modal that never moved. Same check `runAttentionFocus` makes for
 * Cmd+Shift+A (attention-focus-coordinator.ts:80-82) — reused here as its
 * own condition rather than a shared abstraction with that module, which is
 * out of this task's scope.
 */
export function toggleSettingsPanel(focusActive: () => void): void {
  if (settingsOpen.value) {
    closeSettingsPanel(focusActive);
    return;
  }
  if (editorRequest.value !== null || saveDialogOpen.value) {
    return;
  }
  settingsOpen.value = true;
}

export function App() {
  const stagesRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<TabManager | null>(null);

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
   * Settings close: also returns focus to the active pane, matching Escape
   * and the gear button. Defined before the mount effect (like
   * `requestAttentionFocus` above) so `toggleSettings` below — passed into
   * `createTabManager` as the `onToggleSettings` seam for ⌘, and the menu's
   * "Settings…" item — captures this, not a stale reference. Delegates to
   * the module-scope `closeSettingsPanel` (see above) so App keeps owning
   * the close+focus-return flow, the same as every other overlay, while the
   * open/close decision itself stays unit-testable.
   */
  const closePanel = (): void => {
    closeSettingsPanel(() => tabsRef.current?.focusActive());
  };

  /**
   * Toggle Settings open/closed — shared by the gear button (direct call
   * below), ⌘, (keymap.ts `toggle-settings`), and the menu's "Settings…"
   * item, both of the latter through the `onToggleSettings` seam. Delegates
   * to the module-scope `toggleSettingsPanel` (see above) for the actual
   * open/close decision.
   */
  const toggleSettings = (): void => {
    toggleSettingsPanel(() => tabsRef.current?.focusActive());
  };

  useEffect(() => {
    const host = stagesRef.current;
    if (!host) {
      return;
    }
    const manager = createTabManager(host, undefined, {
      onRequestAttentionFocus: (tabIndex) => requestAttentionFocus(tabIndex),
      onToggleSettings: () => toggleSettings(),
    });
    tabsRef.current = manager;
    // Session restore is gone: the app always opens on the board (Intent §Constraint).
    boardOpen.value = true;
    manager.init().catch((err: unknown) => {
      console.error("Failed to initialize terminals:", err);
      boardOpen.value = true;
    });
    return () => {
      manager.dispose();
    };
  }, []);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    installQuitGuard({
      // Quit is busy-guarded like every close path (FR-042 AC-3): silent
      // when all panes are idle, one confirm when anything is running.
      confirmQuit: () => {
        const manager = tabsRef.current;
        return manager
          ? confirmClose(manager.allPaneIds(), defaultPtyClient, QUIT_COPY)
          : Promise.resolve(true);
      },
      flush: flushSettingsSave,
      quit: () => defaultPtyClient.confirmQuit(),
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
    // Workspace ≡ Tab: reopening one that already has a tab focuses that tab
    // instead of cloning it — the chosen preset/agent are deliberately ignored
    // (passing neither to recordWorkspaceOpen keeps the folder's saved combo).
    const existing = tabsRef.current?.findTabByWorkspace(workspace) ?? -1;
    if (existing !== -1) {
      tabsRef.current?.selectTab(existing);
      recordWorkspaceOpen(workspace);
      boardOpen.value = false;
      return true;
    }
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

  /** Editor confirm (FR-015): save the preset, then materialize a new tab. */
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
      const agents = await defaultPtyClient
        .detectAgents()
        .catch((err: unknown) => {
          console.warn("detect_agents failed:", err);
          return [];
        });
      await handleOpen(
        request.workspace,
        preset,
        resolveAgentChoice(undefined, agents),
      );
      return;
    }
    // Live window: inherit panes resolve to the focused pane's CWD (BF-Rule 8);
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

  /** ⌘⇧S / menu: capture live layout into a new or existing preset (FR-012). */
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

  const sidebar = settings.value.tabBarPosition === "left";
  const selectTab = (index: number): void => {
    boardOpen.value = false;
    tabsRef.current?.selectTab(index);
  };
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
      onToggleSettings={toggleSettings}
    />
  );

  return (
    <div class={`window ${sidebar ? "window--sidebar" : ""}`}>
      <div
        class="titlebar"
        data-tauri-drag-region
        onDblClick={() => {
          getCurrentWindow()
            .toggleMaximize()
            .catch((err: unknown) => {
              console.warn("toggleMaximize failed:", err);
            });
        }}
      >
        {/* Sidebar mode has no horizontal bar to host the actions — they ride
            the titlebar, right-aligned, clear of the macOS traffic lights. */}
        {sidebar ? chromeActions : null}
      </div>
      {sidebar ? (
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
      ) : (
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
          onToggleSettings={toggleSettings}
          onFocusAttention={requestAttentionFocus}
        />
      )}
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
        <SettingsPanel open={settingsOpen.value} onClose={closePanel} />
      </main>
      <StatusBar />
    </div>
  );
}
