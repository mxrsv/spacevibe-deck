/**
 * The navigation sidebar's resize seam (DL-18.9).
 *
 * The sidebar had no seam at all until 2026-08-16 — its column was a fixed
 * `--sidebar-w` — so this is the file-explorer grip's shape (DL-19.4) applied
 * to the other edge of the window: drag to resize, drag past the floor to
 * collapse the column to its icon rail, drag back out to restore it.
 *
 * It is a sibling of the rail rather than part of it because two components
 * occupy that slot (`RepositoryRail` and the `WorkspaceSidebar` kept beside it
 * for the one-line revert), and a seam that lived inside one of them would
 * disappear with the revert. It sits in the same grid cell as the rail,
 * pinned to the cell's trailing edge.
 *
 * Collapse is NOT hide: on macOS the frame row — traffic lights included —
 * lives inside this column (DL-18.3), so the column has to survive at a width
 * that still holds them. `sidebarCollapsedWidth` is that floor.
 */
import { signal } from '@preact/signals';
import { SIDEBAR_DRAG_BOUNDS, resolvePanelDrag } from './panel-resize';

/**
 * Width during a resize drag; `null` when no drag is in flight and the
 * persisted `sidebarWidth` setting is authoritative. Same reasoning as
 * `dockWidthLive`: the column and everything laid out beside it need the
 * value every frame, and settings must not be written every pointermove.
 */
export const sidebarWidthLive = signal<number | null>(null);

/**
 * True while the drag has been pulled far enough past the floor that releasing
 * it collapses the column. The rail dims on this instead of collapsing
 * mid-drag — collapsing under the pointer would resize the very element the
 * gesture is anchored to.
 */
export const sidebarCollapseArmed = signal(false);

export interface SidebarGripProps {
  /** The width the column is CURRENTLY painted at, collapsed or not. */
  readonly width: number;
  /** Committed on release, and never on the collapse path. */
  readonly onWidthChange: (width: number) => void;
  /** Flipped on release when the drag ended past the floor, or back out of it. */
  readonly onCollapsedChange: (collapsed: boolean) => void;
}

export function SidebarGrip(props: SidebarGripProps) {
  const startResize = (event: PointerEvent): void => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = props.width;
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);

    const move = (moveEvent: PointerEvent): void => {
      // This grip is on the column's RIGHT (outer) edge, the mirror of the
      // explorer's: dragging right widens it. The raw width goes to
      // `resolvePanelDrag` unclamped, because "past the floor" is the gesture.
      const outcome = resolvePanelDrag(
        startWidth + (moveEvent.clientX - startX),
        SIDEBAR_DRAG_BOUNDS,
      );
      sidebarWidthLive.value = outcome.width;
      sidebarCollapseArmed.value = outcome.collapsed;
    };
    const end = (): void => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', end);
      target.removeEventListener('pointercancel', end);
      const dragged = sidebarWidthLive.value;
      const collapse = sidebarCollapseArmed.value;
      // Cleared before the commit for the same reason the explorer clears its
      // own: the settings write is async and the column would jump for a frame.
      sidebarWidthLive.value = null;
      sidebarCollapseArmed.value = false;
      if (dragged === null) {
        // A click with no movement. Not a resize, and not a toggle either —
        // the stage strip's control is what toggles.
        return;
      }
      props.onCollapsedChange(collapse);
      if (!collapse) {
        // No width write on the collapse path: the user asked for the rail,
        // and persisting the floor would restore a 200px column next time.
        props.onWidthChange(dragged);
      }
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
  };

  return (
    <div
      class="sidebar-grip"
      onPointerDown={startResize}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the sidebar"
    />
  );
}
