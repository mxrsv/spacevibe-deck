import { dockCollapseArmed, dockWidthLive } from "../../files/file-surface-store";
import { dockDragBounds, resolvePanelDrag } from "../panel-resize";

export interface DockResizeGripProps {
  /** The width the column is painted at when the drag starts. */
  readonly width: number;
  /** Committed at the end of a drag, not during it: one settings write. */
  readonly onWidthChange: (width: number) => void;
  /**
   * Hides the column. The drag pulled past the floor ends here rather than writing `dockOpen`,
   * so `App` can keep routing it through the `toggle-dock` action and its focus guard.
   */
  readonly onClose: () => void;
}

/**
 * The seam on a dock column's inner edge (DL-19.4), shared by the tabbed dock and the stacked
 * one so the two cannot disagree about how a drag resizes or collapses. It sits on the column's
 * LEFT edge; the width rides a live signal during the drag and settles into settings on release.
 */
export function DockResizeGrip({ width, onWidthChange, onClose }: DockResizeGripProps) {
  const startResize = (event: PointerEvent): void => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    const bounds = dockDragBounds(window.innerWidth);
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);

    const move = (moveEvent: PointerEvent): void => {
      // The handle is on the column's LEFT edge, so dragging left widens it.
      // The RAW width goes to `resolvePanelDrag`, not a clamped one: clamping
      // maps every overdrag onto the floor, and "past the floor" is exactly
      // what the collapse gesture is made of (DL-19.4).
      const outcome = resolvePanelDrag(startWidth + (startX - moveEvent.clientX), bounds);
      dockWidthLive.value = outcome.width;
      dockCollapseArmed.value = outcome.collapsed;
    };
    const end = (): void => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", end);
      target.removeEventListener("pointercancel", end);
      const dragged = dockWidthLive.value;
      const collapse = dockCollapseArmed.value;
      if (collapse) {
        // Closed BEFORE the live signals are cleared, and the order is
        // load-bearing since the drag began painting the column itself
        // (2026-08-19): clearing first would leave one frame where no drag is
        // in flight and `dockOpen` is still true, and the column the user just
        // dragged away would flash back in before the setting landed.
        // `updateSettings` is synchronous, so closing first closes that gap
        // rather than narrowing it.
        // No width write on this path either: the user asked for the column to
        // go away, and persisting the floor as their preferred width would
        // greet them with a 360px column the next time they open it.
        onClose();
        dockWidthLive.value = null;
        dockCollapseArmed.value = false;
        return;
      }
      // Cleared BEFORE the commit on the resize path: the settings write is
      // async, and leaving the live value up until it lands makes the column
      // jump back to the old width for a frame if the write is slow.
      dockWidthLive.value = null;
      dockCollapseArmed.value = false;
      if (dragged !== null) {
        onWidthChange(dragged);
      }
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", end);
    target.addEventListener("pointercancel", end);
  };

  return (
    <div
      // Lit for the whole gesture, the sidebar seam's reason exactly: the
      // pointer leaves this 9px target almost immediately once the drag is
      // captured (DL-19.4, amended 2026-08-19).
      class={`dock-panel__grip ${dockWidthLive.value === null ? "" : "is-dragging"}`}
      onPointerDown={startResize}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the side panel"
    />
  );
}
