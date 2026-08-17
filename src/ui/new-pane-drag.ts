import type { Edge } from "../lib/split-tree";
import type { PaneRect } from "../lib/pane-geometry";
import { dropTargetAt } from "../terminal/pane-drag";

/**
 * Drag a chrome control onto a pane to dock a NEW pane at one of its edges.
 *
 * The sibling of `terminal/pane-drag.ts`, and deliberately not a mode of it:
 * that controller moves a pane that already exists, hangs off the tab
 * container, and refuses to start below two panes. This one starts from a
 * button in the sidebar, carries no source pane (so every slot is a legal
 * target, including a lone one), and only ever reports where the drop landed —
 * spawning and agent launch stay behind `TabManager` (R4).
 *
 * The 5px threshold is what keeps the control a button: below it nothing is
 * created, no listener is consumed, and the element's own `click` fires
 * untouched. The ghost and the drop overlay are children of `document.body`
 * for the same reason the pane drag puts them there — a re-render mid-drag
 * replaces the stage's children and would otherwise wipe them.
 */
export interface NewPaneDragController {
  dispose(): void;
}

/**
 * What a chrome control needs from its host to become a drop source: where the
 * panes are, and what to do when one is hit. Everything the drag itself owns
 * (ghost text, threshold, overlay) stays out of it, so a component can take
 * this as one prop without learning how the drag works.
 */
export interface NewPaneDropDeps {
  /**
   * Live slot geometry of whatever the stage is showing. An empty list means
   * "nothing to drop onto" — that is how the caller makes the drag inert while
   * a browser or document surface covers the terminal grid, rather than this
   * module learning what a surface is.
   */
  slotRects(): readonly PaneRect[];
  /** The drag passed the threshold — a chance to warm slow lookups. */
  onDragStart?(): void;
  /** Released over a pane: dock a new pane on `edge` of `targetPaneId`. */
  onDrop(targetPaneId: number, edge: Edge): void;
}

export interface NewPaneDragOptions extends NewPaneDropDeps {
  /** Ghost text; the name of the thing being created, not of a pane. */
  ghostLabel: string;
}

const DRAG_THRESHOLD = 5;

export function createNewPaneDragController(
  handle: HTMLElement,
  opts: NewPaneDragOptions,
): NewPaneDragController {
  let startX = 0;
  let startY = 0;
  let pointerId: number | null = null;
  let dragging = false;
  let ghost: HTMLElement | null = null;
  let overlay: HTMLElement | null = null;
  let target: { id: number; edge: Edge } | null = null;

  function onPointerDown(event: PointerEvent): void {
    if (event.button !== 0 || pointerId !== null) {
      return;
    }
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("keydown", onKeyDown, true);
  }

  function beginDrag(): void {
    dragging = true;
    // On `body`, not on a tab container: this controller never gets one, and
    // `.is-pane-dragging .pane` reaches every pane from here just the same.
    document.body.classList.add("is-pane-dragging");
    ghost = document.createElement("div");
    ghost.className = "pane-drag-ghost";
    ghost.textContent = opts.ghostLabel;
    overlay = document.createElement("div");
    overlay.className = "drop-overlay";
    overlay.style.display = "none";
    document.body.append(ghost, overlay);
    opts.onDragStart?.();
  }

  function moveGhost(x: number, y: number): void {
    if (ghost) {
      ghost.style.left = `${x + 12}px`;
      ghost.style.top = `${y + 12}px`;
    }
  }

  function hitTest(x: number, y: number): void {
    // `null` source: no slot is excluded, unlike a pane dragged onto itself.
    const hit = dropTargetAt(opts.slotRects(), x, y, null);
    if (hit === null) {
      target = null;
      hideOverlay();
      return;
    }
    target = { id: hit.id, edge: hit.edge };
    showOverlay(hit.rect, hit.edge);
  }

  function showOverlay(rect: PaneRect, edge: Edge): void {
    if (!overlay) {
      return;
    }
    const fullWidth = rect.right - rect.left;
    const fullHeight = rect.bottom - rect.top;
    let left = rect.left;
    let top = rect.top;
    let width = fullWidth;
    let height = fullHeight;
    if (edge === "left") {
      width = fullWidth / 2;
    } else if (edge === "right") {
      left = rect.left + fullWidth / 2;
      width = fullWidth / 2;
    } else if (edge === "top") {
      height = fullHeight / 2;
    } else {
      top = rect.top + fullHeight / 2;
      height = fullHeight / 2;
    }
    overlay.style.display = "block";
    overlay.style.left = `${left}px`;
    overlay.style.top = `${top}px`;
    overlay.style.width = `${width}px`;
    overlay.style.height = `${height}px`;
  }

  function hideOverlay(): void {
    if (overlay) {
      overlay.style.display = "none";
    }
  }

  function onPointerMove(event: PointerEvent): void {
    if (event.pointerId !== pointerId) {
      return;
    }
    if (!dragging) {
      if (
        Math.abs(event.clientX - startX) < DRAG_THRESHOLD &&
        Math.abs(event.clientY - startY) < DRAG_THRESHOLD
      ) {
        return;
      }
      beginDrag();
    }
    moveGhost(event.clientX, event.clientY);
    hitTest(event.clientX, event.clientY);
  }

  /**
   * A drag that starts and ends over the handle itself still produces a
   * `click`, which would open the board the user was trying NOT to open. One
   * capture-phase swallow, armed only after a real drag, keeps the plain click
   * intact while making an aborted drag do nothing.
   */
  function swallowNextClick(): void {
    const swallow = (event: Event): void => {
      event.preventDefault();
      event.stopPropagation();
      window.removeEventListener("click", swallow, true);
    };
    window.addEventListener("click", swallow, true);
    // A drop over a pane produces no click at all, so the swallow has to
    // expire on its own — leaving it armed would eat an unrelated click later.
    setTimeout(() => window.removeEventListener("click", swallow, true), 0);
  }

  function onPointerUp(event: PointerEvent): void {
    if (event.pointerId !== pointerId) {
      return;
    }
    const wasDragging = dragging;
    const dropTarget = target;
    cleanup();
    if (!wasDragging) {
      return;
    }
    swallowNextClick();
    if (dropTarget) {
      opts.onDrop(dropTarget.id, dropTarget.edge);
    }
  }

  function onPointerCancel(event: PointerEvent): void {
    if (event.pointerId !== pointerId) {
      return;
    }
    cleanup();
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape" && dragging) {
      event.preventDefault();
      cleanup();
    }
  }

  function cleanup(): void {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerCancel);
    window.removeEventListener("keydown", onKeyDown, true);
    document.body.classList.remove("is-pane-dragging");
    ghost?.remove();
    overlay?.remove();
    ghost = null;
    overlay = null;
    target = null;
    pointerId = null;
    dragging = false;
  }

  handle.addEventListener("pointerdown", onPointerDown);

  return {
    dispose(): void {
      handle.removeEventListener("pointerdown", onPointerDown);
      cleanup();
    },
  };
}
