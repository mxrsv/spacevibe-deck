import { isReleaseSwitchEnabled } from "../lib/release-switches";
import { rendererReleaseSwitches } from "../terminal/action-availability";

/** The class `App` puts on `.stage` while the flush stage is on; `31-shell-stage.css` keys on it. */
export const STAGE_FLUSH_CLASS = "stage--flush";

/** The `:root` class carrying the mock's taller frame row (`31-shell-stage.css`). */
export const SHELL_FRAME_CLASS = "shell-frame";

/** DL §7: one rail press, one fade of the pane's ring. */
const PANE_FLASH_MS = 600;

interface PaneFlashSelection {
  readonly onFocusPane: (tabIndex: number, paneId: number) => void;
  readonly onSelectTab: (tabIndex: number) => void;
}

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

/** The pane a slot shows: inside it, or in the zoom overlay when this slot's pane is zoomed. */
function paneOfSlot(slot: HTMLElement): HTMLElement | null {
  return (
    slot.querySelector<HTMLElement>(":scope > .pane") ??
    slot.closest(".is-zoomed")?.querySelector<HTMLElement>(":scope > .zoom-overlay > .pane") ??
    null
  );
}

/** A second press during the fade starts a new animation, which replaces the running one. */
function flashRing(slot: HTMLElement | null | undefined): void {
  const pane = slot ? paneOfSlot(slot) : null;
  if (!pane || !shellStageEnabled() || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }
  pane.animate([{ borderColor: "var(--foreground)" }, { borderColor: "transparent" }], {
    duration: PANE_FLASH_MS,
    easing: "ease-out",
  });
}

/**
 * Shows where a rail press landed: the pane's ring lights up once and fades. The next frame, because
 * the press may have just switched tab, and a tab builds its slots when it is first shown.
 */
export function flashPane(paneId: number): void {
  requestAnimationFrame(() => {
    flashRing(document.querySelector<HTMLElement>(`.pane-slot[data-pane-id="${paneId}"]`));
  });
}

/** The same for a press that names a tab, not a pane: the pane that tab has focused. */
export function flashActivePane(): void {
  requestAnimationFrame(() => {
    const visible = [...document.querySelectorAll<HTMLElement>(".pane-slot")].filter((slot) =>
      slot.checkVisibility(),
    );
    const active = visible.find((slot) => slot.classList.contains("is-active"));
    flashRing(active ?? (visible.length === 1 ? visible[0] : null));
  });
}

/** A rail selection whose presses also flash the pane they land on. */
export function withPaneFlash(selection: PaneFlashSelection): PaneFlashSelection {
  return {
    onFocusPane: (tabIndex, paneId) => {
      selection.onFocusPane(tabIndex, paneId);
      flashPane(paneId);
    },
    onSelectTab: (tabIndex) => {
      selection.onSelectTab(tabIndex);
      flashActivePane();
    },
  };
}

/**
 * `--frame-h` sizes the shell's grid row, which sits above `.stage`, so the flush stage's class
 * cannot reach it. On `:root` for the same reason as `sidebar-shell.ts`: props on the element
 * `DesktopChrome` returns never update.
 */
export function applyShellFrame(root: HTMLElement): void {
  root.classList.toggle(SHELL_FRAME_CLASS, shellStageEnabled());
}
