/**
 * Channel and event names shared by the main process, the preload bridge and
 * the renderer facades.
 *
 * These are deliberately IDENTICAL to the Tauri build's command and event
 * names. The renderer's listeners, the existing Vitest suite and the IPC
 * contract test all key off these strings, so keeping them means the migration
 * changes the host without changing the wire.
 */

/** Commands: renderer → main, request/response. */
export const CHANNELS = {
  spawnShell: "spawn_shell",
  writePty: "write_pty",
  resizePty: "resize_pty",
  killPty: "kill_pty",
  ptyInfo: "pty_info",
  gitBranch: "git_branch",
  // Repository/worktree rail. Electron-only, like the two blocks at the foot
  // of this table: no `#[tauri::command]` counterpart exists, and writing one
  // would implement a feature twice on a host `AGENTS.md` has frozen. See
  // `docs/specs/2026-08-13-repository-worktree-rail-design.md` §7.3.
  gitRepository: "git_repository",
  // Create-worktree flow (open board, task 16). Electron-only like the block
  // above: no `#[tauri::command]` counterpart, per the frozen Tauri host.
  worktreeAdd: "worktree_add",
  detectAgents: "detect_agents",
  dirsExist: "dirs_exist",
  desktopEnvironment: "desktop_environment",
  resolvePaths: "resolve_paths",
  openEditor: "open_editor",
  listPromptAssets: "list_prompt_assets",
  readImageAsDataUrl: "read_image_as_data_url",
  scanWorkspaceFavicon: "scan_workspace_favicon",
  confirmQuit: "confirm_quit",
  cancelQuit: "cancel_quit",
  confirmCloseWindow: "confirm_close_window",
  cancelCloseWindow: "cancel_close_window",
  windowBootMode: "window_boot_mode",
  openPaneWindow: "open_pane_window",
  offerTransfer: "offer_transfer",
  focusOrder: "focus_order",
  prepareTransfer: "prepare_transfer",
  stageTransfer: "stage_transfer",
  claimTransfer: "claim_transfer",
  commitTransfer: "commit_transfer",
  abortTransfer: "abort_transfer",
  beginUpdateCheck: "begin_update_check",
  endUpdateCheck: "end_update_check",
  applySettingsPatch: "apply_settings_patch",
  suspendMenuAccelerators: "suspend_menu_accelerators",
  // File explorer. Every one of these is bounded to a workspace root by
  // `electron/fs/path-guard.ts` — the renderer names the path, and the
  // renderer is not the trust boundary. No renderer calls them yet: the model
  // and host layers merged, the surface was left to the redesign.
  listDir: "list_dir",
  readFile: "read_file",
  writeFile: "write_file",
  statFiles: "stat_files",
  watchPaths: "watch_paths",
  setDirtyFiles: "set_dirty_files",
  // Browser panel. No Tauri counterpart exists — the panel is Electron-only,
  // so unlike every channel above these names are new rather than ported.
  browserOpen: "browser_open",
  browserClose: "browser_close",
  browserNavigate: "browser_navigate",
  browserBack: "browser_back",
  browserForward: "browser_forward",
  browserReload: "browser_reload",
  browserSetBounds: "browser_set_bounds",
  browserSetVisible: "browser_set_visible",
  browserSetInspect: "browser_set_inspect",
  // Token usage. The name matches the Tauri command it was ported from, so
  // the renderer facade is host-agnostic; the payload is empty by contract
  // (the scan takes no renderer input at all).
  usageSnapshot: "usage_snapshot",
} as const;

/** Events: main → renderer, fire and forget. */
export const EVENTS = {
  ptyOutput: "pty:output",
  ptyExit: "pty:exit",
  ptyPromptReady: "pty:prompt-ready",
  menuAction: "menu:action",
  menuMovePaneToWindow: "menu:move-pane-to-window",
  transferOffer: "transfer:offer",
  transferSettled: "transfer:settled",
  quitRequested: "quit-requested",
  windowCloseRequested: "window:close-requested",
  settingsMerged: "settings:merged",
  fileChanged: "fs:changed",
  browserState: "browser:state",
  browserGrab: "browser:grab",
  // Committed main-frame navigations only — never in-page hash changes. What
  // the renderer persists as `browserLastUrl` (browser productization §3).
  browserNavigated: "browser:navigated",
} as const;

export type ChannelName = (typeof CHANNELS)[keyof typeof CHANNELS];
export type EventName = (typeof EVENTS)[keyof typeof EVENTS];
