import { createContext } from "preact";

/**
 * How tall a tree row is and where depth 0 starts. A surface that hosts the Explorer provides its
 * own (the dock's tree pane uses taller rows); every index `FileTreeView` windows by is computed
 * from `rowHeight`, so it lives here and not in a stylesheet.
 */
export interface TreeMetrics {
  readonly rowHeight: number;
  readonly inset: number;
}

/** DL-19: data rows are 22px. */
export const TreeMetricsContext = createContext<TreeMetrics>({ rowHeight: 22, inset: 8 });
