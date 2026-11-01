/**
 * A change's added and removed line counts (`+12 −3`), as Changes, the dock and the hunk queue
 * show them. `--term-ok` and `--term-err` are the terminal palette's green and red: the layout
 * mock declares them in `mocks.css`, the app on `.agent-dock__column` (27-dock-stacked.css). A
 * region that uses this block outside the dock declares them on its own root.
 */
export function ChangeCounts({
  added,
  removed,
}: {
  readonly added: number;
  readonly removed: number;
}) {
  return (
    <span className="shrink-0 font-mono text-code tabular-nums">
      <span className="text-(--term-ok)">+{added}</span>{" "}
      <span className="text-(--term-err)">−{removed}</span>
    </span>
  );
}
