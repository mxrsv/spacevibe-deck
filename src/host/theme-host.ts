/**
 * The themes folder — read, import into, reveal.
 *
 * Electron-only, like `worktree-host.ts` next door: there is no `#[tauri::
 * command]` counterpart and writing one would implement a feature twice on a
 * host `AGENTS.md` has frozen. On the Tauri build every call below rejects;
 * `custom-themes-store.ts` keeps the last-good snapshot and exposes that host
 * failure rather than pretending the folder was read as empty.
 *
 * The renderer receives file TEXT, never parsed themes: parsing lives in
 * `src/settings/theme-formats/` so the four grammars have one implementation
 * and a test suite that does not need a main process.
 */
import { invoke } from "./bridge";

export interface ThemeFileEntry {
  /** Basename inside the themes folder — the identity of an imported theme. */
  readonly fileName: string;
  readonly content: string;
}

/** A file the host refused, with the sentence to show for it (DL-24.6). */
export interface ThemeFileRejection {
  readonly fileName: string;
  readonly reason: string;
}

/**
 * What the host answers with: the files it read, and the ones it would not.
 *
 * The rejections travel with the entries rather than being dropped host-side
 * because a file the user picked that never becomes a card has to be able to
 * say why — an import that vanishes reads as one that never happened.
 */
export interface ThemeScan {
  readonly entries: readonly ThemeFileEntry[];
  readonly rejected: readonly ThemeFileRejection[];
}

/** Everything currently in the themes folder. Empty when the folder is new. */
export function listThemeFiles(): Promise<ThemeScan> {
  return invoke<ThemeScan>("themes_list");
}

/**
 * Open the native file picker and copy what the user chose into the folder.
 *
 * Resolves to the folder's full contents afterwards, not just the new files:
 * the folder is the source of truth, so one round trip that re-reads it keeps
 * the renderer from having to merge two lists and get the order wrong. Files
 * refused at the picker (wrong type, too large, uncopyable) come back in
 * `rejected` — they never reach the folder, so the scan alone cannot report
 * them.
 */
export function importThemeFiles(): Promise<ThemeScan> {
  return invoke<ThemeScan>("themes_import");
}

/** Show the themes folder in the OS file manager — the way to remove a theme. */
export function revealThemesFolder(): Promise<void> {
  return invoke("themes_reveal");
}
