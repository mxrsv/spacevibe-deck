/**
 * The sidebar column's two live shell values, written to `:root` (DL-18.9).
 *
 * `--sidebar-w` and the collapsed flag are set imperatively, the way
 * `applyThemeVars` sets the theme tokens, rather than as `class`/`style` props
 * on the window shell. That is not a preference — it is a workaround for a
 * defect measured in the running app on 2026-08-16: props on the element
 * `DesktopChrome` RETURNS are applied on mount and never updated again, while
 * its children update normally. The same defect already reaches shipped
 * behaviour — flipping `tabBarPosition` in Settings leaves `window--sidebar`
 * on the shell — so it pre-dates this work and is reported rather than fixed
 * here (`docs/CONTEXT.md`). Writing to `:root` sidesteps it entirely: nothing
 * about these two values needs to travel through the shell's props.
 *
 * `:root` is also where the CSS fallbacks for both already live, so a value
 * set here replaces exactly the declaration it is overriding.
 */
export interface SidebarShellState {
  /** The width the column is painted at — live drag, collapsed floor, or setting. */
  readonly width: number;
  /** Painted collapsed, which during a drag is the ARMED state, not the setting. */
  readonly collapsed: boolean;
  /** False in top-tab layout, where there is no column to describe. */
  readonly sidebar: boolean;
}

export const SIDEBAR_COLLAPSED_ATTR = 'data-sidebar-collapsed';

export function applySidebarShell(root: HTMLElement, state: SidebarShellState): void {
  if (!state.sidebar) {
    // Top-tab layout has no sidebar column. Both values are removed rather
    // than left at their last sidebar-mode reading, so the stylesheet's own
    // declarations are what answer while no column exists.
    root.style.removeProperty('--sidebar-w');
    root.removeAttribute(SIDEBAR_COLLAPSED_ATTR);
    return;
  }
  root.style.setProperty('--sidebar-w', `${state.width}px`);
  root.setAttribute(SIDEBAR_COLLAPSED_ATTR, state.collapsed ? 'true' : 'false');
}
