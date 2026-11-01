/**
 * A change's added and removed line counts (`+12 −3`), as Changes, the dock and the hunk queue
 * show them. `--term-ok` and `--term-err` are the terminal palette's green and red; the layout
 * mock declares them, the app's theme must before a region using this block cuts over.
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
