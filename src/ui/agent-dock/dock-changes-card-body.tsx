import { useMemo } from "preact/hooks";
import { cn } from "@/lib/cn";
import type { DiffSidesView } from "../../files/changes/diff-sides";
import { diffLines, type DiffHunk, type DiffLine } from "../../files/changes/line-diff";

/**
 * A changed line is the theme's green or red mixed opaquely into the diff's ground, with its
 * number in the full ink and a bar beside it, so the change reads from the gutter alone; context
 * and `@@` sit near the ground and carry no colour. The mixes are opaque because the gutter
 * sticks over the code when the lines scroll sideways.
 */
const LINE_LOOK: Readonly<
  Record<DiffLine["kind"], { sign: string; line: string; gutter: string; ink: string }>
> = {
  context: {
    sign: " ",
    line: "text-muted-foreground",
    gutter: "bg-background text-(--text-faint)",
    ink: "",
  },
  add: {
    sign: "+",
    line: "bg-[color-mix(in_lab,var(--background)_80%,var(--term-ok))]",
    gutter:
      "bg-[color-mix(in_lab,var(--background)_85%,var(--term-ok))] text-(--term-ok) shadow-[inset_3px_0_0_var(--term-ok)]",
    ink: "text-(--term-ok)",
  },
  del: {
    sign: "-",
    line: "bg-[color-mix(in_lab,var(--background)_80%,var(--term-err))]",
    gutter:
      "bg-[color-mix(in_lab,var(--background)_85%,var(--term-err))] text-(--term-err) shadow-[inset_3px_0_0_var(--term-err)]",
    ink: "text-(--term-err)",
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
      <div className="bg-[color-mix(in_oklch,var(--background)_94%,var(--foreground))] px-3 text-muted-foreground">
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
