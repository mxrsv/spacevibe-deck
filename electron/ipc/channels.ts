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
} as const;

export type ChannelName = (typeof CHANNELS)[keyof typeof CHANNELS];
export type EventName = (typeof EVENTS)[keyof typeof EVENTS];
