import {
  expandForPane,
  ratioEntries,
  type LeafNode,
  type Path,
  type SplitNode,
  type TreeNode,
} from "../lib/split-tree";
import type { PaneRect } from "../lib/pane-geometry";

/** Minimum share the Focused pane gets on each split along its path. */
export const EXPAND_RATIO = 0.65;

const RATIO_MIN = 0.15;
const RATIO_MAX = 0.85;

/**
 * Tree shown in the flex DOM: Focus Expand overlay when enabled, else the
 * structural tree. Pure — the LayoutEngine applies this via applyRatios.
 */
export function computeDisplayTree(
  tree: TreeNode,
  activeId: number | null,
  focusExpand: boolean,
  paneCount: number,
  expandRatio: number = EXPAND_RATIO,
): TreeNode {
  if (!focusExpand || paneCount <= 1 || activeId === null) {
    return tree;
  }
  return expandForPane(tree, activeId, expandRatio);
}

export interface LayoutEngineHost {
  getPaneElement(paneId: number): HTMLElement | undefined;
  mountPane(paneId: number): void;
  fitPane(paneId: number): void;
  focusPane(paneId: number): void;
}

export interface LayoutSyncInput {
  readonly tree: TreeNode;
  readonly activeId: number | null;
  readonly paneCount: number;
  readonly focusExpand: boolean;
  /** Structural ratio commit — caller updates the tree, then refreshOverlay. */
  onRatioCommit(path: Path, ratio: number): void;
}

export interface LayoutOverlayInput {
  readonly tree: TreeNode;
  readonly activeId: number | null;
  readonly paneCount: number;
  readonly focusExpand: boolean;
}

/**
 * Deep Layout display module: structural tree → visible flex DOM, Focus
 * Expand overlay, zoom, active highlight, divider commits.
 * Pane/PTY attach stays on TerminalManager behind LayoutEngineHost.
 */
export interface LayoutEngine {
  /** Rebuild DOM from the structural tree; unzooms; mounts panes; overlays. */
  sync(input: LayoutSyncInput): void;
  /** Overlay ratios + active classes without rebuilding (focus / settings). */
  refreshOverlay(input: LayoutOverlayInput): void;
  /** Maximize Focused pane; call again to restore. */
  toggleZoom(activeId: number | null, paneCount: number): void;
  unzoom(): void;
  zoomedId(): number | null;
  /**
   * Live viewport geometry of every pane slot. The slot DOM is private to
   * this module — hit-testing consumers (focus direction, file drop, pane
   * drag) go through this instead of querying `.pane-slot` themselves.
   */
  slotRects(): PaneRect[];
  /** Pane whose slot contains the viewport point; null when none. */
  paneIdAt(x: number, y: number): number | null;
  /** Highlight one slot as the file-drop target; null clears the highlight. */
  setDropTarget(id: number | null): void;
}

export function createLayoutEngine(container: HTMLElement, host: LayoutEngineHost): LayoutEngine {
  let zoomed: number | null = null;
  let zoomOverlay: HTMLElement | null = null;

  function unzoom(): void {
    if (zoomed === null) {
      return;
    }
    const pane = host.getPaneElement(zoomed);
    const slot = container.querySelector<HTMLElement>(`.pane-slot[data-pane-id="${zoomed}"]`);
    if (pane && slot) {
      slot.appendChild(pane);
    }
    zoomOverlay?.remove();
    zoomOverlay = null;
    container.classList.remove("is-zoomed");
    const restored = zoomed;
    zoomed = null;
    host.fitPane(restored);
  }

  function updateActiveClasses(activeId: number | null, paneCount: number): void {
    const highlight = paneCount > 1;
    for (const slot of container.querySelectorAll<HTMLElement>(".pane-slot")) {
      slot.classList.toggle("is-active", highlight && Number(slot.dataset.paneId) === activeId);
    }
  }

  function applyOverlay(input: LayoutOverlayInput): void {
    applyRatios(
      container,
      computeDisplayTree(input.tree, input.activeId, input.focusExpand, input.paneCount),
    );
  }

  function sync(input: LayoutSyncInput): void {
    // Structural rebuild re-slots every pane — a live zoom overlay would be
    // left covering the tab while its pane is stolen back into the tree.
    unzoom();
    container.classList.toggle("has-multiple-panes", input.paneCount > 1);
    // Build from the ORIGINAL tree so dividers capture original ratios as
    // their commit baseline (onUp fires even on a click without dragging).
    renderTree(container, input.tree, {
      getPaneElement: (id) => host.getPaneElement(id),
      isActive: (id) => id === input.activeId,
      highlightActive: input.paneCount > 1,
      onRatioCommit: input.onRatioCommit,
    });
    for (const id of leafIdsLocal(input.tree)) {
      host.mountPane(id);
    }
    applyOverlay(input);
  }

  function refreshOverlay(input: LayoutOverlayInput): void {
    updateActiveClasses(input.activeId, input.paneCount);
    applyOverlay(input);
  }

  function toggleZoom(activeId: number | null, paneCount: number): void {
    if (zoomed !== null) {
      unzoom();
      if (activeId !== null) {
        host.focusPane(activeId);
      }
      return;
    }
    if (activeId === null || paneCount <= 1) {
      return;
    }
    const pane = host.getPaneElement(activeId);
    if (!pane) {
      return;
    }
    zoomOverlay = document.createElement("div");
    zoomOverlay.className = "zoom-overlay";
    zoomOverlay.appendChild(pane);
    container.appendChild(zoomOverlay);
    container.classList.add("is-zoomed");
    zoomed = activeId;
    host.fitPane(activeId);
    host.focusPane(activeId);
  }

  function slotRects(): PaneRect[] {
    const rects: PaneRect[] = [];
    for (const slot of container.querySelectorAll<HTMLElement>(".pane-slot")) {
      const id = Number(slot.dataset.paneId);
      if (Number.isNaN(id)) {
        continue;
      }
      const r = slot.getBoundingClientRect();
      rects.push({
        id,
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
      });
    }
    return rects;
  }

  function paneIdAt(x: number, y: number): number | null {
    for (const rect of slotRects()) {
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return rect.id;
      }
    }
    return null;
  }

  function setDropTarget(id: number | null): void {
    for (const slot of container.querySelectorAll<HTMLElement>(".pane-slot")) {
      slot.classList.toggle("is-drop-target", id !== null && Number(slot.dataset.paneId) === id);
    }
  }

  return {
    sync,
    refreshOverlay,
    toggleZoom,
    unzoom,
    zoomedId: () => zoomed,
    slotRects,
    paneIdAt,
    setDropTarget,
  };
}

// --- DOM builders (formerly layout.ts) — private to this module ---

interface LayoutContext {
  getPaneElement(paneId: number): HTMLElement | undefined;
  isActive(paneId: number): boolean;
  highlightActive: boolean;
  onRatioCommit(path: Path, ratio: number): void;
}

function renderTree(container: HTMLElement, root: TreeNode, ctx: LayoutContext): void {
  container.replaceChildren(buildNode(root, [], ctx));
}

function buildNode(node: TreeNode, path: Path, ctx: LayoutContext): HTMLElement {
  return node.kind === "leaf" ? buildLeaf(node, ctx) : buildSplit(node, path, ctx);
}

function buildLeaf(node: LeafNode, ctx: LayoutContext): HTMLElement {
  const slot = document.createElement("div");
  slot.className = "pane-slot";
  slot.dataset.paneId = String(node.paneId);
  if (ctx.highlightActive && ctx.isActive(node.paneId)) {
    slot.classList.add("is-active");
  }
  const pane = ctx.getPaneElement(node.paneId);
  if (pane) {
    slot.appendChild(pane);
  }
  return slot;
}

function buildSplit(node: SplitNode, path: Path, ctx: LayoutContext): HTMLElement {
  const split = document.createElement("div");
  split.className = `split split--${node.dir}`;

  const first = document.createElement("div");
  first.className = "split__child";
  first.style.flexGrow = String(node.ratio);
  first.appendChild(buildNode(node.a, [...path, "a"], ctx));

  const second = document.createElement("div");
  second.className = "split__child";
  second.style.flexGrow = String(1 - node.ratio);
  second.appendChild(buildNode(node.b, [...path, "b"], ctx));

  const divider = buildDivider(node, path, { split, first, second }, ctx);

  split.append(first, divider, second);
  return split;
}

interface SplitElements {
  split: HTMLElement;
  first: HTMLElement;
  second: HTMLElement;
}

function buildDivider(
  node: SplitNode,
  path: Path,
  elements: SplitElements,
  ctx: LayoutContext,
): HTMLElement {
  const divider = document.createElement("div");
  divider.className = "split__divider";

  divider.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    divider.setPointerCapture(event.pointerId);
    divider.classList.add("is-dragging");
    elements.split.classList.add("is-resizing");
    let ratio = node.ratio;

    const onMove = (moveEvent: PointerEvent): void => {
      const rect = elements.split.getBoundingClientRect();
      const position =
        node.dir === "row"
          ? (moveEvent.clientX - rect.left) / rect.width
          : (moveEvent.clientY - rect.top) / rect.height;
      ratio = Math.min(RATIO_MAX, Math.max(RATIO_MIN, position));
      elements.first.style.flexGrow = String(ratio);
      elements.second.style.flexGrow = String(1 - ratio);
    };

    const onUp = (): void => {
      divider.removeEventListener("pointermove", onMove);
      divider.classList.remove("is-dragging");
      elements.split.classList.remove("is-resizing");
      ctx.onRatioCommit(path, ratio);
    };

    divider.addEventListener("pointermove", onMove);
    divider.addEventListener("pointerup", onUp, { once: true });
  });

  return divider;
}

/**
 * Write the tree's ratios into the existing DOM without rebuilding it, so
 * the flex-grow CSS transition animates. Private — only LayoutEngine calls this.
 */
function applyRatios(container: HTMLElement, root: TreeNode | null): void {
  if (!root) {
    return;
  }
  const rootEl = container.firstElementChild;
  if (!rootEl) {
    return;
  }
  for (const entry of ratioEntries(root)) {
    const splitEl = resolveSplitElement(rootEl, entry.path);
    if (!splitEl) {
      continue;
    }
    const children = splitEl.querySelectorAll<HTMLElement>(":scope > .split__child");
    if (children.length !== 2) {
      continue;
    }
    children[0].style.flexGrow = String(entry.ratio);
    children[1].style.flexGrow = String(1 - entry.ratio);
  }
}

function resolveSplitElement(rootEl: Element, path: Path): Element | null {
  let current: Element = rootEl;
  for (const branch of path) {
    const children = current.querySelectorAll(":scope > .split__child");
    const next = children[branch === "a" ? 0 : 1]?.firstElementChild ?? null;
    if (!next) {
      return null;
    }
    current = next;
  }
  return current;
}

/** Local leaf walk so layout-engine does not re-export split-tree leafIds. */
function leafIdsLocal(node: TreeNode): number[] {
  if (node.kind === "leaf") {
    return [node.paneId];
  }
  return [...leafIdsLocal(node.a), ...leafIdsLocal(node.b)];
}
