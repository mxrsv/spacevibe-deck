import { useMemo } from "preact/hooks";
import { cn } from "@/lib/cn";
import type { DiffSidesView } from "../../files/changes/diff-sides";
import { diffLines, type DiffHunk, type DiffLine } from "../../files/changes/line-diff";

const LINE_LOOK: Readonly<Record<DiffLine["kind"], { sign: string; tint: string }>> = {
  context: { sign: " ", tint: "" },
  add: { sign: "+", tint: "bg-[color-mix(in_oklch,var(--term-ok)_9%,transparent)]" },
  del: { sign: "-", tint: "bg-[color-mix(in_oklch,var(--term-err)_9%,transparent)]" },
};

const range = (start: number, lines: number): string =>
  lines === 1 ? `${start}` : `${start},${lines}`;

function Hunk({ hunk }: { hunk: DiffHunk }) {
  return (
    <>
      <div className="min-w-max px-3 text-muted-foreground">
        @@ -{range(hunk.oldStart, hunk.oldLines)} +{range(hunk.newStart, hunk.newLines)} @@
      </div>
      {hunk.lines.map((line, index) => (
        <div
          // A hunk is never reordered: the position is the identity.
          key={index}
          data-line={line.kind}
          className={cn("min-w-max px-3", LINE_LOOK[line.kind].tint)}
        >
          <span className="inline-block w-4 select-none text-muted-foreground">
            {LINE_LOOK[line.kind].sign}
          </span>
          {line.text}
        </div>
      ))}
    </>
  );
}

const Line = ({ children }: { children: string }) => (
  <p role="status" className="px-3 py-1.5 text-xs text-muted-foreground">
    {children}
  </p>
);

function CardLines({ view }: { view: DiffSidesView | null }) {
  const shown = useMemo(
    () => (view?.kind === "text" ? diffLines(view.original.text, view.modified.text) : null),
    [view],
  );
  if (view === null) {
    return <Line>Reading…</Line>;
  }
  if (view.kind === "binary") {
    return <Line>Binary file.</Line>;
  }
  if (view.kind === "too-large") {
    return <Line>This file is too large to show.</Line>;
  }
  if (view.kind === "failed") {
    return <Line>{view.message}</Line>;
  }
  if (shown === null || shown.tooLarge) {
    return <Line>Too many changes to show.</Line>;
  }
  if (shown.hunks.length === 0) {
    return <Line>No line changes.</Line>;
  }
  return (
    <div className="overflow-x-auto py-1 font-mono text-code leading-5 whitespace-pre">
      {shown.hunks.map((hunk) => (
        <Hunk key={`${hunk.oldStart}:${hunk.newStart}`} hunk={hunk} />
      ))}
    </div>
  );
}

/**
 * A Changes card's body (DOCK-10): a text diff's side note (a rename from outside the folder),
 * then its unified hunks, or one line for a file that has none to show.
 */
export function CardBody({ view }: { view: DiffSidesView | null }) {
  const note = view?.kind === "text" ? view.note : null;
  return (
    <>
      {note === null ? null : <p className="px-3 pt-1.5 text-xs text-muted-foreground">{note}</p>}
      <CardLines view={view} />
    </>
  );
}
