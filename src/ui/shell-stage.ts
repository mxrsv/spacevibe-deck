import { isReleaseSwitchEnabled } from "../lib/release-switches";
import { rendererReleaseSwitches } from "../terminal/action-availability";

/** The class `App` puts on `.stage` while the flush stage is on; `31-shell-stage.css` keys on it. */
export const STAGE_FLUSH_CLASS = "stage--flush";

/** The `:root` class carrying the mock's taller frame row (`31-shell-stage.css`). */
export const SHELL_FRAME_CLASS = "shell-frame";

/** On a `.pane-slot` while its ring flashes (`31-shell-stage.css`). */
const PANE_FLASH_CLASS = "is-flashing";

/** Read at render time, never into a constant (release-switch convention). */
export function shellStageEnabled(): boolean {
  return isReleaseSwitchEnabled("shellStage", rendererReleaseSwitches());
}

/**
 * The "needs you" control lives on the stage bar instead of the rail's search row (LAY-3), and
 * replaces the strip's older chip there. It needs both the flush stage and the project rail:
 * a press unfolds the target's project and walks the rail's rows.
 */
export function stageAttentionPillEnabled(): boolean {
  return shellStageEnabled() && isReleaseSwitchEnabled("projectRail", rendererReleaseSwitches());
}

/**
 * Shows where a rail press landed: the pane's ring lights up once and fades. The next frame, because
 * the press may have just switched tab, and a tab builds its slots when it is first shown.
 */
export function flashPane(paneId: number): void {
  requestAnimationFrame(() => {
    const slot = document.querySelector<HTMLElement>(`.pane-slot[data-pane-id="${paneId}"]`);
    const pane = slot?.querySelector<HTMLElement>(":scope > .pane");
    if (!slot || !pane) return;
    slot.classList.remove(PANE_FLASH_CLASS);
    void slot.offsetWidth; // A second press during the fade restarts it.
    slot.classList.add(PANE_FLASH_CLASS);
    const stop = new AbortController();
    const settle = (event: AnimationEvent): void => {
      if (event.target !== pane) return;
      slot.classList.remove(PANE_FLASH_CLASS);
      stop.abort();
    };
    pane.addEventListener("animationend", settle, { signal: stop.signal });
    pane.addEventListener("animationcancel", settle, { signal: stop.signal });
  });
}

/**
 * `--frame-h` sizes the shell's grid row, which sits above `.stage`, so the flush stage's class
 * cannot reach it. On `:root` for the same reason as `sidebar-shell.ts`: props on the element
 * `DesktopChrome` returns never update.
 */
export function applyShellFrame(root: HTMLElement): void {
  root.classList.toggle(SHELL_FRAME_CLASS, shellStageEnabled());
}
