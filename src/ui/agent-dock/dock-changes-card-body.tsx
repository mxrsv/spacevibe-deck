import { useMemo } from "preact/hooks";
import { cn } from "@/lib/cn";
import type { DiffSidesView } from "../../files/changes/diff-sides";
import { diffLines, type DiffHunk, type DiffLine } from "../../files/changes/line-diff";

/**
 * RCP-22 (DOCK-10): a changed line is its hue mixed 20% (lab) into the card (`--diff-add-bg`), its
 * gutter a 15% mix with the number in status ink and a 3px bar (`.dock-diff-bar`, in
 * 27-dock-stacked.css), so the change reads from the gutter alone; context is muted and the `@@`
 * line sits on `--diff-hunk-bg`. The mixes are opaque because the gutter sticks over the code when
 * the lines scroll sideways.
 */
const LINE_LOOK: Readonly<
  Record<DiffLine["kind"], { sign: string; line: string; gutter: string; ink: string }>
> = {
  context: {
    sign: " ",
    line: "text-(--text-muted)",
    gutter: "bg-(--card-bg) text-(--text-faint)",
    ink: "",
  },
  add: {
    sign: "+",
    line: "bg-(--diff-add-bg) text-(--text-primary)",
    gutter: "dock-diff-bar dock-diff-bar--add bg-(--diff-add-gutter) text-(--ink-ok)",
    ink: "text-(--ink-ok)",
  },
  del: {
    sign: "-",
    line: "bg-(--diff-del-bg) text-(--text-primary)",
    gutter: "dock-diff-bar dock-diff-bar--del bg-(--diff-del-gutter) text-(--ink-fail)",
    ink: "text-(--ink-fail)",
  },
};

const range = (start: number, lines: number): string =>
  lines === 1 ? `${start}` : `${start},${lines}`;

/** Each line's number: the old one for a removed line, the new one otherwise. */
function lineNumbers(hunk: DiffHunk): number[] {
  let before = hunk.oldStart;
  let after = hunk.newStart;
  return hunk.lines.map((line) => {
    if (line.kind === "del") {
      return before++;
    }
    before += line.kind === "context" ? 1 : 0;
    return after++;
  });
}

function Hunk({ hunk, gutter }: { hunk: DiffHunk; gutter: string }) {
  const numbers = lineNumbers(hunk);
  return (
    <>
      <div className="bg-(--diff-hunk-bg) px-3 text-(--text-faint)">
        @@ -{range(hunk.oldStart, hunk.oldLines)} +{range(hunk.newStart, hunk.newLines)} @@
      </div>
      {hunk.lines.map((line, index) => {
        const look = LINE_LOOK[line.kind];
        return (
          <div
            // A hunk is never reordered: the position is the identity.
            key={index}
            data-line={line.kind}
            className={cn("flex", look.line)}
          >
            {/* Not part of the code: a copy leaves it out, and a reader hears the sign. */}
            <span
              aria-hidden="true"
              style={{ width: gutter }}
              className={cn(
                "sticky left-0 box-border shrink-0 pr-2 text-right tabular-nums select-none",
                look.gutter,
              )}
            >
              {numbers[index]}
            </span>
            <span className={cn("w-4 shrink-0 select-none", look.ink)}>{look.sign}</span>
            <span className="pr-3">{line.text}</span>
          </div>
        );
      })}
    </>
  );
}

/** The gutter fits the card's largest line number, so every line's code starts in one column. */
function gutterWidth(hunks: readonly DiffHunk[]): string {
  const last = Math.max(
    ...hunks.map((hunk) => Math.max(hunk.oldStart + hunk.oldLines, hunk.newStart + hunk.newLines)),
  );
  return `${String(last).length + 2}ch`;
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
  const gutter = gutterWidth(shown.hunks);
  return (
    <div className="overflow-x-auto bg-background py-1 font-mono text-code leading-5 whitespace-pre">
      {/* As wide as the longest line, so every row's wash runs to the end when it scrolls. */}
      <div className="w-max min-w-full">
        {shown.hunks.map((hunk) => (
          <Hunk key={`${hunk.oldStart}:${hunk.newStart}`} hunk={hunk} gutter={gutter} />
        ))}
      </div>
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
