import type { Edge } from '../lib/split-tree';
import type { PaneRect } from '../lib/pane-geometry';
import { hasPrimaryModifier } from '../lib/platform';

export interface PaneDragController {
  dispose(): void;
}

interface PaneDragOptions {
  paneCount(): number;
  /** Pane owning a DOM node (the drag handle); null when none. */
  paneIdForElement(el: Element): number | null;
  /** Live slot geometry (LayoutEngine owns the slot DOM). */
  slotRects(): readonly PaneRect[];
  /** Ghost text for the dragged pane (its CWD label). */
  ghostLabel(id: number): string;
  onMove(sourceId: number, targetId: number, edge: Edge): void;
  /** Cmd held on drop: swap the two panes' positions instead of docking. */
  onSwap(sourceId: number, targetId: number): void;
}

/** Dock lands on an edge; swap covers the whole target pane. */
type DropEdge = Edge | 'full';
type DragMode = 'dock' | 'swap';

const DRAG_THRESHOLD = 5;

export function dragModeForEvent(
  event: Readonly<Pick<KeyboardEvent, 'metaKey' | 'ctrlKey'>>,
): DragMode {
  return hasPrimaryModifier(event) ? 'swap' : 'dock';
}

/** Nearest edge by normalized distance to all four edges (diagonal split). Pure. */
export function edgeFor(rect: PaneRect, x: number, y: number): Edge {
  const width = rect.right - rect.left;
  const height = rect.bottom - rect.top;
  const left = (x - rect.left) / width;
  const right = (rect.right - x) / width;
  const top = (y - rect.top) / height;
  const bottom = (rect.bottom - y) / height;
  const min = Math.min(left, right, top, bottom);
  if (min === left) {
    return 'left';
  }
  if (min === right) {
    return 'right';
  }
  if (min === top) {
    return 'top';
  }
  return 'bottom';
}

/**
 * Dock target under the cursor: the hovered pane (never the source) and the
 * edge to split on. Pure — feed it rects to test hit logic without a DOM.
 */
export function dropTargetAt(
  rects: readonly PaneRect[],
  x: number,
  y: number,
  sourceId: number | null,
): { id: number; edge: Edge; rect: PaneRect } | null {
  for (const rect of rects) {
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
      if (rect.id === sourceId) {
        return null; // hovering the source itself — no dock
      }
      return { id: rect.id, edge: edgeFor(rect, x, y), rect };
    }
  }
  return null;
}

/**
 * Drag a pane by its header bar and dock it onto an edge of another pane.
 * A single delegated pointerdown listener lives on the tab container (which
 * survives layout.sync — only its children are replaced); the ghost and the
 * drop overlay are children of document.body so a re-render mid-drag cannot
 * wipe them.
 */
export function createPaneDragController(
  container: HTMLElement,
  opts: PaneDragOptions,
): PaneDragController {
  let startX = 0;
  let startY = 0;
  let sourceId: number | null = null;
  let pointerId: number | null = null;
  let dragging = false;
  let ghost: HTMLElement | null = null;
  let overlay: HTMLElement | null = null;
  let target: { id: number; edge: DropEdge } | null = null;
  // "swap" while the platform modifier is held; toggles live mid-drag.
  let mode: DragMode = 'dock';
  // Last cursor position lets a modifier change re-run the hit test in place.
  let lastX = 0;
  let lastY = 0;

  function onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) {
      return;
    }
    const el = event.target as HTMLElement;
    if (el.closest('.split__divider')) {
      return; // let the divider handle its own resize drag
    }
    const handle = el.closest('.pane__bar, .pane__anchor');
    if (!handle) {
      return; // only drag from the header bar or the hover anchor
    }
    if (opts.paneCount() < 2) {
      return;
    }
    const id = opts.paneIdForElement(handle);
    if (id === null) {
      return;
    }
    sourceId = id;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    // Not dragging yet — wait for the threshold in pointermove.
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
  }

  function beginDrag(): void {
    dragging = true;
    container.classList.add('is-pane-dragging');
    if (pointerId !== null) {
      try {
        container.setPointerCapture(pointerId);
      } catch {
        // pointer already released — ignore
      }
    }
    ghost = document.createElement('div');
    ghost.className = 'pane-drag-ghost';
    ghost.textContent = sourceId === null ? 'pane' : opts.ghostLabel(sourceId);
    overlay = document.createElement('div');
    overlay.className = 'drop-overlay';
    overlay.style.display = 'none';
    // ALWAYS append to body — layout.sync's replaceChildren(container) would wipe them.
    document.body.append(ghost, overlay);
  }

  function moveGhost(x: number, y: number): void {
    if (ghost) {
      ghost.style.left = `${x + 12}px`;
      ghost.style.top = `${y + 12}px`;
    }
  }

  function hitTest(x: number, y: number): void {
    const hit = dropTargetAt(opts.slotRects(), x, y, sourceId);
    if (hit === null) {
      target = null;
      hideOverlay();
      return;
    }
    // Swap ignores the edge — the whole target pane is the drop zone.
    const edge: DropEdge = mode === 'swap' ? 'full' : hit.edge;
    target = { id: hit.id, edge };
    showOverlay(hit.rect, edge);
  }

  function showOverlay(rect: PaneRect, edge: DropEdge): void {
    if (!overlay) {
      return;
    }
    const fullWidth = rect.right - rect.left;
    const fullHeight = rect.bottom - rect.top;
    let left = rect.left;
    let top = rect.top;
    let width = fullWidth;
    let height = fullHeight;
    if (edge === 'full') {
      // whole pane — the full rect set above already covers it
    } else if (edge === 'left') {
      width = fullWidth / 2;
    } else if (edge === 'right') {
      left = rect.left + fullWidth / 2;
      width = fullWidth / 2;
    } else if (edge === 'top') {
      height = fullHeight / 2;
    } else {
      top = rect.top + fullHeight / 2;
      height = fullHeight / 2;
    }
    overlay.classList.toggle('is-swap', edge === 'full');
    overlay.style.display = 'block';
    overlay.style.left = `${left}px`;
    overlay.style.top = `${top}px`;
    overlay.style.width = `${width}px`;
    overlay.style.height = `${height}px`;
  }

  function hideOverlay(): void {
    if (overlay) {
      overlay.style.display = 'none';
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
    mode = dragModeForEvent(event);
    lastX = event.clientX;
    lastY = event.clientY;
    moveGhost(event.clientX, event.clientY);
    hitTest(event.clientX, event.clientY);
  }

  function onPointerUp(event: PointerEvent): void {
    if (event.pointerId !== pointerId) {
      return;
    }
    const wasDragging = dragging;
    const dropTarget = target;
    const src = sourceId;
    cleanup();
    if (wasDragging && dropTarget && src !== null) {
      // The overlay the user saw decides the action: "full" = swap.
      if (dropTarget.edge === 'full') {
        opts.onSwap(src, dropTarget.id);
      } else {
        opts.onMove(src, dropTarget.id, dropTarget.edge);
      }
    }
  }

  function onPointerCancel(event: PointerEvent): void {
    if (event.pointerId !== pointerId) {
      return;
    }
    cleanup();
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && dragging) {
      event.preventDefault();
      cleanup();
      return;
    }
    syncMode(event);
  }

  function onKeyUp(event: KeyboardEvent): void {
    syncMode(event);
  }

  /** Follow the live primary modifier; re-hit-test so the overlay flips. */
  function syncMode(event: KeyboardEvent): void {
    if (!dragging) {
      return;
    }
    const next = dragModeForEvent(event);
    if (next === mode) {
      return;
    }
    mode = next;
    hitTest(lastX, lastY);
  }

  function cleanup(): void {
    if (pointerId !== null) {
      try {
        container.releasePointerCapture(pointerId);
      } catch {
        // never captured — ignore
      }
    }
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('keyup', onKeyUp, true);
    container.classList.remove('is-pane-dragging');
    ghost?.remove();
    overlay?.remove();
    ghost = null;
    overlay = null;
    target = null;
    mode = 'dock';
    lastX = 0;
    lastY = 0;
    sourceId = null;
    pointerId = null;
    dragging = false;
  }

  container.addEventListener('pointerdown', onPointerDown);

  return {
    dispose(): void {
      container.removeEventListener('pointerdown', onPointerDown);
      cleanup();
    },
  };
}
