import { isReleaseSwitchEnabled } from "../lib/release-switches";
import { rendererReleaseSwitches } from "../terminal/action-availability";

/** The class `App` puts on `.stage` while the flush stage is on; `31-shell-stage.css` keys on it. */
export const STAGE_FLUSH_CLASS = "stage--flush";

/** The `:root` class carrying the mock's taller frame row (`31-shell-stage.css`). */
export const SHELL_FRAME_CLASS = "shell-frame";

/** Read at render time, never into a constant (release-switch convention). */
export function shellStageEnabled(): boolean {
  return isReleaseSwitchEnabled("shellStage", rendererReleaseSwitches());
}

/**
 * `--frame-h` sizes the shell's grid row, which sits above `.stage`, so the flush stage's class
 * cannot reach it. On `:root` for the same reason as `sidebar-shell.ts`: props on the element
 * `DesktopChrome` returns never update.
 */
export function applyShellFrame(root: HTMLElement): void {
  root.classList.toggle(SHELL_FRAME_CLASS, shellStageEnabled());
}
