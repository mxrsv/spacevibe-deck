import { miniColumns, type SpacePane } from "./space-model";

/**
 * A space's panes in miniature, each tinted by its state (DL-35.3). A square
 * grid rather than the real split tree: it says how many and in what state,
 * and costs no layout read of a tab that is not on screen.
 */
export function SpaceMini({
  panes,
  class: className,
}: {
  panes: readonly SpacePane[];
  class?: string;
}) {
  return (
    <span
      class={`space-mini ${className ?? ""}`}
      style={{ gridTemplateColumns: `repeat(${miniColumns(panes.length)}, 1fr)` }}
      aria-hidden="true"
    >
      {panes.map((pane) => (
        <i key={pane.paneId} data-state={pane.state} />
      ))}
    </span>
  );
}
