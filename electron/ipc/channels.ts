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
  // "Star on GitHub", read and write, through the user's own `gh` CLI.
  // Electron-only like the block above; on Tauri both facades report the
  // capability absent and the button falls back to opening the repository.
  githubStarState: "github_star_state",
  githubStar: "github_star",
  // Session restore. Electron-only, like the block above: no
  // `#[tauri::command]` counterpart, and Tauri is feature-frozen.
  resumeLookup: "resume_lookup",
  // Tier 3 of the agent rail (spec §5): newest agent turn per pane. Same
  // request shape as `resume_lookup` and the same scanners behind it, so the
  // rail's sentence names the session restore would resume into. Electron-only,
  // like the block above.
  sessionTail: "session_tail",
  // Window label accessor, for the same restore work: no renderer accessor
  // existed before this (main derived it per-request via `labelOf(event)`
  // only). Electron-only, like the block above.
  windowLabel: "window_label",
  detectAgents: "detect_agents",
  dirsExist: "dirs_exist",
  desktopEnvironment: "desktop_environment",
  resolvePaths: "resolve_paths",
  openEditor: "open_editor",
  // Opening a path an agent printed (spec 2026-08-19). Electron-only, like the
  // blocks below: no `#[tauri::command]` counterpart, and Tauri keeps today's
  // behaviour whole — every ⌘+click there still goes out through `open_editor`
  // above, which is deliberately UNCHANGED so the Rust twin stays valid.
  // `workspace_for_path` is what routes a click into Deck's own editor; the
  // other two are the external-app catalog and its launcher.
  workspaceForPath: "workspace_for_path",
  externalApps: "external_apps",
  openInApp: "open_in_app",
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
  prepareTransfer: "prepare_transfer",
  stageTransfer: "stage_transfer",
  claimTransfer: "claim_transfer",
  commitTransfer: "commit_transfer",
  abortTransfer: "abort_transfer",
  beginUpdateCheck: "begin_update_check",
  endUpdateCheck: "end_update_check",
  // Auto-update. Electron-only, unlike the two names above: Tauri reaches its
  // own updater plugin from the renderer
  // (`src/updater/tauri-updater-adapter.ts`) and never through IPC, so no
  // `#[tauri::command]` counterpart exists or should. All three are
  // zero-payload — the renderer names no version, no URL and no file; the
  // feed and the pending update live in `electron/updater/updater.ts`.
  updateCheck: "update_check",
  updateDownload: "update_download",
  updateInstall: "update_install",
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
  // Themes folder. Electron-only, like the repository and browser blocks
  // above: no `#[tauri::command]` counterpart, and the renderer degrades to
  // built-in themes wherever these are unanswered. All three take no payload —
  // the folder is `<userData>/themes` and the renderer never names a path.
  themesList: "themes_list",
  themesImport: "themes_import",
  themesReveal: "themes_reveal",
  // Session history. Electron-only like the blocks above: no `#[tauri::command]`
  // counterpart, and the renderer hides its control wherever this is
  // unanswered. Flat `{ limit }` per R6; the reply is
  // `electron/sessions/model.ts`'s `SessionsSnapshot`.
  sessionsList: "sessions_list",
  // Opt-in usage analytics (spec 2026-08-22). Electron-only like the blocks
  // above: Tauri has no handler, so the renderer's `available` flag is false
  // there and nothing counts, renders or sends. `telemetry_count` is fire and
  // forget; the other two read and change main-owned consent state. No
  // identifier ever crosses into the renderer over any of the three.
  telemetryCount: "telemetry_count",
  telemetryState: "telemetry_state",
  telemetrySetEnabled: "telemetry_set_enabled",
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
  // Broadcast when a background store write fails, so every window can raise
  // its persist-error bar. Registered with a bare string in
  // `register-store.ts` until the preload gained an event allowlist and it had
  // to be a name both sides agree on.
  storeWriteFailed: "store:write-failed",
  // Broadcast when the main-owned analytics consent state changes, so every
  // window's consent row and Privacy section move together (spec §6: both
  // choices dismiss the row across every window). Carries consent state only —
  // never a daily id.
  telemetryState: "telemetry:state-changed",
} as const;

/**
 * Commands registered with a bare string rather than through `CHANNELS`.
 *
 * These predate the table — they are the Tauri plugin surfaces (store, dialog,
 * clipboard, notification, shell, app, window) whose names came from the
 * plugins themselves. They are listed here for one reason: the preload bridge
 * needs the COMPLETE set of invokable names, and `scripts/electron-ipc-contract.test.ts`
 * proves this list plus `CHANNELS` is exactly what the main process registers.
 */
export const PLUGIN_CHANNELS = [
  "app_relaunch",
  "app_version",
  "clipboard_read_text",
  "clipboard_write_text",
  "dialog_ask",
  "dialog_message",
  "dialog_open",
  "notification_permission_granted",
  "notification_request_permission",
  "notification_send",
  "shell_open_url",
  "store_delete",
  "store_get",
  "store_load",
  "store_save",
  "store_set",
  "window_close",
  "window_toggle_maximize",
] as const;

/**
 * Every channel the renderer is allowed to invoke.
 *
 * The preload bridge used to forward ANY name straight to `ipcRenderer.invoke`,
 * so one injected script in a renderer that runs with `sandbox: false` reached
 * the whole host surface in a line — `spawn_shell` plus `write_pty` is
 * arbitrary command execution. Nothing about the app needs an open bridge:
 * this is the closed set, and the contract test fails if a registration ever
 * appears outside it.
 */
export const INVOKABLE_CHANNELS: ReadonlySet<string> = new Set<string>([
  ...Object.values(CHANNELS),
  ...PLUGIN_CHANNELS,
]);

export type ChannelName = (typeof CHANNELS)[keyof typeof CHANNELS];
export type EventName = (typeof EVENTS)[keyof typeof EVENTS];
