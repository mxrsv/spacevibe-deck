import type { SerializedNode } from "../lib/split-tree";
import type { TabDotColor } from "../lib/tab-colors";

export const MAX_CLOSED_TABS = 10;

/**
 * Everything needed to reopen a closed tab with fresh shells: the layout
 * serialization intentionally drops pane ids and cwds, so cwds are carried
 * alongside in leafIds() (left-to-right) order — treeFromLayout assigns new
 * pane ids in the same order on restore.
 *
 * CWD assembly lives in `tab-materialize` (`fresh` policy) — this module is
 * the LIFO stack only.
 */
export interface ClosedTabSnapshot {
  readonly layout: SerializedNode;
  readonly name: string | null;
  readonly dotColor: TabDotColor | null;
  readonly cwds: readonly (string | null)[];
  /** Workspace the tab belonged to — reopen keeps the same identity. */
  readonly workspacePath: string | null;
}

/** New stack with `snapshot` on top; oldest entries drop beyond the cap. */
export function pushClosedTab(
  stack: readonly ClosedTabSnapshot[],
  snapshot: ClosedTabSnapshot,
): readonly ClosedTabSnapshot[] {
  return [...stack, snapshot].slice(-MAX_CLOSED_TABS);
}

/** [top, rest] of the stack; [null, stack] when empty. */
export function popClosedTab(
  stack: readonly ClosedTabSnapshot[],
): readonly [ClosedTabSnapshot | null, readonly ClosedTabSnapshot[]] {
  if (stack.length === 0) {
    return [null, stack];
  }
  return [stack[stack.length - 1], stack.slice(0, -1)];
}
