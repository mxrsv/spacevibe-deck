/**
 * A change's added and removed line counts (`+12 −3`), as Changes, the dock and the hunk queue
 * show them; a zero side is neutral ink, not green or red (DL-3.2). `--term-ok` and `--term-err`
 * are the terminal palette's green and red: the layout mock declares them in `mocks.css`, the app
 * on `.agent-dock__column` (27-dock-stacked.css). A region that uses this block outside the dock
 * declares them on its own root.
 */
export function ChangeCounts({
  added,
  removed,
  sans = false,
}: {
  readonly added: number;
  readonly removed: number;
  /** Set the counts in the UI face instead of mono (the dock's Changes view, DOCK-12). */
  readonly sans?: boolean;
}) {
  return (
    <span
      className={
        sans ? "shrink-0 text-xs tabular-nums" : "shrink-0 font-mono text-code tabular-nums"
      }
    >
      <span className={added > 0 ? "text-(--term-ok)" : "text-muted-foreground"}>+{added}</span>{" "}
      <span className={removed > 0 ? "text-(--term-err)" : "text-muted-foreground"}>
        −{removed}
      </span>
    </span>
  );
}
