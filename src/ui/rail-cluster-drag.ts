/**
 * Drag a project cluster in the agent rail to where it should sit (DL-27.20).
 *
 * See `docs/internals/agent-rail.md` (section "Order").
 * The third member of this repo's pointer-drag family, after
 * [`pane-drag.ts`](../terminal/pane-drag.ts) `current` (move an existing pane)
 * and [`new-pane-drag.ts`](./new-pane-drag.ts) `current` (drag a control onto
 * a pane). It follows their bargain exactly: a 5px threshold, so below it
 * nothing is consumed and the header's own `click` — the collapse toggle,
 * which is nearly the whole header — fires untouched; past it the drag starts
 * and the click is swallowed.
 *
 * NOT HTML5 drag-and-drop, for the same reasons the other two are not: a drag
 * image nobody can style, a `dragover` cadence that fights an auto-scroll, and
 * no Escape.
 *
 * ONE controller for the whole list, by delegation, rather than one per
 * header. A cluster header re-renders whenever an agent says something, so a
 * per-element controller would be disposed mid-drag; the window listeners this
 * one installs on `pointerdown` outlive any number of re-renders.
 *
 * The ghost and the insertion line are children of `document.body` for the
 * reason both siblings give: a re-render mid-drag replaces the rail's children
 * and would otherwise wipe them.
 */
export interface RailClusterDragController {
  dispose(): void;
}

export interface RailClusterDragDeps {
  /** The drag passed the threshold — a chance to warm slow lookups. */
  onDragStart?(): void;
  /**
   * Released over a slot: move the cluster at `from` to index `to`, where `to`
   * is a coordinate in the list the dragged cluster has already been removed
   * from. Never called for a drop that lands where the cluster started.
   */
  onDrop(from: number, to: number): void;
}

/** One cluster block, header plus every tab row under it. */
const CLUSTER = ".asr-cluster";
/** The grab surface: the header line, and nothing else in the cluster. */
const HEAD = ".asr-cluster__head";
/**
 * The two small controls that are never a grab surface (spec §6). They sit
 * INSIDE the header, so a press on either would otherwise start a drag and
 * lose its click — and both of them are one-press actions.
 */
const EXCLUDED = ".asr-cluster__add, .asr-cluster__remove";
/** The header's own label, which is what the ghost carries. */
const NAME = ".asr-cluster__name";
/**
 * The cluster's stable project identity, written by the component. The drag
 * remembers this rather than the index it was pressed at: the rail re-renders
 * whenever an agent says something, so a positional index taken at
 * `pointerdown` can name a different project by the time the pointer comes up.
 */
const ORDER_KEY = "orderKey";

const DRAG_THRESHOLD = 5;
/** How close to the scrollport's edge the pointer auto-scrolls the list. */
const EDGE = 28;
/** Pixels per frame at the very edge; it eases in across `EDGE`. */
const EDGE_SPEED = 12;

export function createRailClusterDragController(
  list: HTMLElement,
  deps: RailClusterDragDeps,
): RailClusterDragController {
  let startX = 0;
  let startY = 0;
  let pointerId: number | null = null;
  let dragging = false;
  /** The dragged project's identity, resolved back to an index at drop time. */
  let fromKey = "";
  let ghostLabel = "";
  let ghost: HTMLElement | null = null;
  let line: HTMLElement | null = null;
  /** Slot the drop would land in, as an insert-BEFORE index in 0..count. */
  let insertAt = -1;
  /**
   * The pointer's last position. Every measurement reads THIS rather than an
   * event, so several `pointermove`s inside one frame cost one pass, and so the
   * auto-scroll can re-answer "which slot" for a pointer that is holding still
   * while the list moves under it.
   */
  let lastX = 0;
  let lastY = 0;
  /** The one scheduled pass; `null` when nothing is pending. */
  let frame: number | null = null;
  /** Escape was pressed: the pointer is still down, but no drop will happen. */
  let cancelled = false;

  function clusters(): HTMLElement[] {
    return [...list.querySelectorAll<HTMLElement>(CLUSTER)];
  }

  function onPointerDown(event: PointerEvent): void {
    if (event.button !== 0 || pointerId !== null) {
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    if (target === null || target.closest(EXCLUDED) !== null) {
      return;
    }
    const head = target.closest(HEAD);
    if (head === null) {
      return;
    }
    const cluster = head.closest<HTMLElement>(CLUSTER);
    const key = cluster?.dataset[ORDER_KEY] ?? "";
    if (key === "") {
      return;
    }
    fromKey = key;
    ghostLabel = head.querySelector(NAME)?.textContent ?? "";
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    lastX = event.clientX;
    lastY = event.clientY;
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("keydown", onKeyDown, true);
  }

  function beginDrag(): void {
    dragging = true;
    // On `body`, so a rail re-render cannot take the drag's own chrome with
    // it, and so the ghost is not clipped by the list's `overflow`.
    document.body.classList.add("is-rail-dragging");
    ghost = document.createElement("div");
    // The app's one drag-ghost shell plus this surface's deltas — the same
    // element the pane drags raise, so a tweak to the vocabulary reaches both.
    ghost.className = "pane-drag-ghost rail-drag-ghost";
    ghost.textContent = ghostLabel;
    line = document.createElement("div");
    line.className = "rail-drag-line";
    line.style.display = "none";
    document.body.append(ghost, line);
    deps.onDragStart?.();
  }

  /**
   * How far from the top of the list the pointer is: the slot it would drop
   * into, and how fast the list should scroll under it.
   *
   * The gap is the first cluster whose MIDPOINT the pointer has not passed,
   * else the end of the list — midpoints rather than edges, so the slot flips
   * when the pointer is more than half way across a neighbour instead of the
   * moment it touches it.
   */
  function measure(blocks: readonly HTMLElement[]): {
    slot: number;
    lineTop: number | null;
    left: number;
    width: number;
    velocity: number;
  } {
    const listRect = list.getBoundingClientRect();
    const tops = blocks.map((block) => block.getBoundingClientRect());
    let slot = blocks.length;
    for (const [index, rect] of tops.entries()) {
      if (lastY < rect.top + rect.height / 2) {
        slot = index;
        break;
      }
    }
    const anchor = tops[slot] ?? tops[tops.length - 1];
    const above = listRect.top + EDGE - lastY;
    const below = lastY - (listRect.bottom - EDGE);
    let velocity = 0;
    if (above > 0) {
      velocity = -Math.min(EDGE_SPEED, (above / EDGE) * EDGE_SPEED);
    } else if (below > 0) {
      velocity = Math.min(EDGE_SPEED, (below / EDGE) * EDGE_SPEED);
    }
    const edge = anchor === undefined ? null : slot < tops.length ? anchor.top : anchor.bottom;
    return {
      slot,
      // Clamped to the scrollport. The line is `position: fixed`, so it does
      // not travel with the list's scroll and nothing clips it: a slot whose
      // cluster is scrolled half out of view has a rect ABOVE the list, and
      // the line would paint across the stage strip and the traffic lights.
      lineTop: edge === null ? null : Math.min(Math.max(edge, listRect.top), listRect.bottom),
      left: listRect.left,
      width: listRect.width,
      velocity,
    };
  }

  /**
   * One pass of the drag, ONCE per frame: every measurement first, then every
   * write. A pointer can fire several `pointermove` events inside one frame, and
   * each of those used to run a `querySelectorAll`, a rect read per cluster and
   * a write to the ghost's inline style — a write-then-read order that forces a
   * synchronous layout the browser then throws away before it paints. Reading
   * the pointer's LAST position on a frame instead answers the same question
   * once.
   *
   * It also subsumes the auto-scroll's own loop. Near the list's top or bottom
   * edge the list scrolls under a pointer that is holding still — without it a
   * project cannot be dragged past the rows the viewport happens to be showing
   * — and every cluster's rect changes as it does, so the slot and the line
   * have to be re-answered on exactly the frames the scroll moves them.
   *
   * Nothing is cached across frames on purpose: the rail re-renders whenever an
   * agent says something, which replaces these very elements, and a cache that
   * outlived one frame would silently answer for clusters that are gone.
   */
  function runFrame(): void {
    frame = null;
    if (!dragging || cancelled) {
      return;
    }
    const geometry = measure(clusters());
    insertAt = geometry.slot;
    if (ghost !== null) {
      ghost.style.left = `${lastX + 12}px`;
      ghost.style.top = `${lastY + 12}px`;
    }
    if (line !== null) {
      if (geometry.lineTop === null) {
        line.style.display = "none";
      } else {
        line.style.display = "block";
        line.style.left = `${geometry.left}px`;
        line.style.width = `${geometry.width}px`;
        // Centred on the gap rather than sitting on the row's first pixel.
        line.style.top = `${geometry.lineTop - 1}px`;
      }
    }
    // Scrolled LAST, so this frame's reads all happened before any write. The
    // next frame measures the list where this scroll left it.
    if (geometry.velocity !== 0) {
      list.scrollTop += geometry.velocity;
      // The pointer may never move again; the scroll alone has to keep the
      // frames coming until it leaves the edge band.
      schedule();
    }
  }

  function schedule(): void {
    if (frame === null) {
      frame = requestAnimationFrame(runFrame);
    }
  }

  function onPointerMove(event: PointerEvent): void {
    if (event.pointerId !== pointerId || cancelled) {
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
    lastX = event.clientX;
    lastY = event.clientY;
    schedule();
  }

  /**
   * A drag that starts and ends over the header still produces a `click`,
   * which would collapse the project the user was trying to move. One
   * capture-phase swallow, armed only after a real drag, keeps the plain click
   * intact — the `new-pane-drag.ts` bargain, including the timeout: a drop
   * that lands elsewhere produces no click at all, so leaving the swallow
   * armed would eat an unrelated one later.
   */
  function swallowNextClick(): void {
    const swallow = (event: Event): void => {
      event.preventDefault();
      event.stopPropagation();
      window.removeEventListener("click", swallow, true);
    };
    window.addEventListener("click", swallow, true);
    setTimeout(() => window.removeEventListener("click", swallow, true), 0);
  }

  function onPointerUp(event: PointerEvent): void {
    if (event.pointerId !== pointerId) {
      return;
    }
    const wasDragging = dragging;
    const abandoned = cancelled;
    lastX = event.clientX;
    lastY = event.clientY;
    // A flick can cross the threshold and release inside ONE frame, which is
    // ordinary at a high pointer poll rate. The batched pass never ran, so
    // `insertAt` is still -1 — and a drag the user completed must not be
    // silently discarded because the clock did not tick. One synchronous
    // measurement at the release position answers the same question the frame
    // would have. It is the only unbatched measure left, and it happens once
    // per drag at most.
    const slot = wasDragging && !abandoned && insertAt < 0 ? measure(clusters()).slot : insertAt;
    // Resolved HERE, not at `pointerdown`: the rail re-renders whenever an
    // agent says something, so a project closing mid-drag shifts every index
    // below it. The identity is what was pressed; the index is only ever a
    // fact about the list as it stands right now, and `insertAt` came from
    // that same list a moment ago.
    const source = clusters().findIndex((block) => block.dataset[ORDER_KEY] === fromKey);
    cleanup();
    if (!wasDragging) {
      return;
    }
    // Armed for EVERY real drag, before any reason to abandon it is read —
    // `new-pane-drag.ts` swallows on `wasDragging` alone and this has to as
    // well. Otherwise an abandoned or unresolvable drag lets its release reach
    // the header and collapse the project it was trying to move.
    swallowNextClick();
    // `abandoned`: Escape already said no.
    // `source < 0`: the project left the rail while it was being dragged — or
    // its scan landed mid-drag and re-keyed it, a known silent no-op.
    if (slot < 0 || abandoned || source < 0) {
      return;
    }
    // `insertAt` counts gaps in the list as it stands; `to` counts slots in
    // the list the dragged cluster has already left, which is the coordinate
    // a reorder is expressed in.
    const to = slot > source ? slot - 1 : slot;
    if (to !== source) {
      deps.onDrop(source, to);
    }
  }

  function onPointerCancel(event: PointerEvent): void {
    if (event.pointerId !== pointerId) {
      return;
    }
    cleanup();
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape" && dragging && !cancelled) {
      event.preventDefault();
      // Abandoned: the drop will not happen and nothing is written. The
      // LISTENERS stay, because the pointer is still down — releasing it over
      // the source header fires a `click` that would collapse the project the
      // user just decided not to move, and `pointerup` is where that click is
      // swallowed. Only the drag's chrome goes now.
      cancelled = true;
      clearVisuals();
    }
  }

  /**
   * Everything the drag PAINTS. Escape takes this and leaves the listeners
   * standing, because the pointer is still down and its release still has a
   * click to swallow.
   */
  function clearVisuals(): void {
    document.body.classList.remove("is-rail-dragging");
    if (frame !== null) {
      cancelAnimationFrame(frame);
    }
    frame = null;
    ghost?.remove();
    line?.remove();
    ghost = null;
    line = null;
  }

  function cleanup(): void {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerCancel);
    window.removeEventListener("keydown", onKeyDown, true);
    clearVisuals();
    insertAt = -1;
    fromKey = "";
    ghostLabel = "";
    pointerId = null;
    dragging = false;
    cancelled = false;
  }

  list.addEventListener("pointerdown", onPointerDown);

  return {
    dispose(): void {
      list.removeEventListener("pointerdown", onPointerDown);
      cleanup();
    },
  };
}
