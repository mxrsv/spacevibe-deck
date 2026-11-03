import { ArrowDown01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { cn } from "@/lib/cn";
import { readHeadFile, type ChangeEntry } from "../../host/git-changes-host";
import { absolutePath, baseName, countsFor } from "../../files/changes/changes-model";
import {
  createDiffSides,
  type DiffSidesPorts,
  type DiffSidesView,
} from "../../files/changes/diff-sides";
import {
  colorizeLines,
  MAX_COLORIZED_CHARS,
  type ColorizeLines,
} from "../../files/changes/colorize-lines";
import {
  diffLines,
  numberLines,
  type DiffHunk,
  type DiffLine,
} from "../../files/changes/line-diff";
import { defaultFileClient } from "../../files/file-client";
import type { FileSurfaceController } from "../../files/file-surface-controller";
import { settings } from "../../settings/settings-store";
import { ChangeCounts } from "../blocks/change-counts";
import { Button } from "../controls/button";
import { DeckIcon } from "../controls/deck-icon";
import { dockFoldedCards, selectDockFile, toggleDockCardFold } from "./agent-dock-state";
import { StatusMark } from "./dock-changes-tree";

/** How far past the viewport a card starts reading its two sides. */
const NEAR_MARGIN = "600px 0px";

/** The sides' two reads over the window's real file and git channels. */
export const defaultStackPorts: DiffSidesPorts = {
  statFiles: (root, paths) => defaultFileClient.statFiles(root, paths),
  readFile: (root, path) => defaultFileClient.readFile(root, path),
  readHeadFile,
};

export const cardKey = (root: string, path: string): string => `${root}\0${path}`;

/** A line's sign and its wash (mock F: 13% of the diff ink); context lines carry neither. */
const LINE_LOOK: Readonly<Record<DiffLine["kind"], { sign: string; tint: string }>> = {
  context: { sign: " ", tint: "" },
  add: { sign: "+", tint: "bg-[color-mix(in_oklch,var(--term-ok)_13%,transparent)]" },
  del: { sign: "-", tint: "bg-[color-mix(in_oklch,var(--term-err)_13%,transparent)]" },
};

const range = (start: number, lines: number): string =>
  lines === 1 ? `${start}` : `${start},${lines}`;

/** Each side's lines as the colorizer marked them up; null while plain. */
interface LitSides {
  readonly original: readonly string[];
  readonly modified: readonly string[];
}

/** The widest line number a card prints, in digits, so both gutters fit it and line up. */
function gutterDigits(hunks: readonly DiffHunk[]): number {
  const last = hunks.reduce(
    (widest, hunk) =>
      Math.max(widest, hunk.oldStart + hunk.oldLines, hunk.newStart + hunk.newLines),
    1,
  );
  return String(last).length;
}

const GUTTER =
  "box-content shrink-0 pr-2 text-right text-muted-foreground tabular-nums select-none";

function Hunk({
  hunk,
  digits,
  lit,
}: {
  readonly hunk: DiffHunk;
  readonly digits: number;
  readonly lit: LitSides | null;
}) {
  const gutter = { width: `${digits}ch` };
  return (
    <>
      <div className="min-w-max bg-primary/8 px-3 text-primary">
        @@ -{range(hunk.oldStart, hunk.oldLines)} +{range(hunk.newStart, hunk.newLines)} @@
      </div>
      {numberLines(hunk).map((line, index) => {
        // A removed line is coloured from the old text, every other line from the new one.
        const html =
          lit === null
            ? undefined
            : line.oldLine !== null && line.newLine === null
              ? lit.original[line.oldLine - 1]
              : line.newLine !== null
                ? lit.modified[line.newLine - 1]
                : undefined;
        return (
          <div
            // A hunk is never reordered: the position is the identity.
            key={index}
            data-line={line.kind}
            className={cn("flex min-w-max pl-1", LINE_LOOK[line.kind].tint)}
          >
            <span aria-hidden="true" className={GUTTER} style={gutter}>
              {line.oldLine ?? ""}
            </span>
            <span aria-hidden="true" className={GUTTER} style={gutter}>
              {line.newLine ?? ""}
            </span>
            <span className="w-4 shrink-0 text-center text-muted-foreground select-none">
              {LINE_LOOK[line.kind].sign}
            </span>
            {html === undefined ? (
              <span className={cn("pr-3", line.kind === "context" && "text-muted-foreground")}>
                {line.text}
              </span>
            ) : (
              // Monaco's colorizer escapes the text it marks up (`colorize-lines.ts`).
              <span className="pr-3" dangerouslySetInnerHTML={{ __html: html }} />
            )}
          </div>
        );
      })}
    </>
  );
}

const Line = ({ children }: { children: string }) => (
  <p role="status" className="px-3 py-1.5 text-xs text-muted-foreground">
    {children}
  </p>
);

/** Colours a loaded text card once, again for a new read or a theme change; plain until then. */
function useLitSides(view: DiffSidesView | null, colorize: ColorizeLines): LitSides | null {
  const [lit, setLit] = useState<LitSides | null>(null);
  const theme = settings.value.themeId;
  useEffect(() => {
    setLit(null);
    if (view?.kind !== "text") {
      return;
    }
    const language = view.modified.language ?? view.original.language;
    const { original, modified } = view;
    if (
      language === null ||
      original.text.length > MAX_COLORIZED_CHARS ||
      modified.text.length > MAX_COLORIZED_CHARS
    ) {
      return;
    }
    let current = true;
    Promise.all([colorize(original.text, language), colorize(modified.text, language)])
      .then(([oldLines, newLines]) => {
        if (current) {
          setLit({ original: oldLines, modified: newLines });
        }
      })
      // The plain text is already right; a tokenizer that refused this text is not worth a line.
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [view, colorize, theme]);
  return lit;
}

function CardBody({
  view,
  colorize,
}: {
  readonly view: DiffSidesView | null;
  readonly colorize: ColorizeLines;
}) {
  const shown = useMemo(
    () => (view?.kind === "text" ? diffLines(view.original.text, view.modified.text) : null),
    [view],
  );
  const lit = useLitSides(view, colorize);
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
  const digits = gutterDigits(shown.hunks);
  return (
    <div className="overflow-x-auto bg-[color-mix(in_oklch,var(--background)_70%,var(--sidebar))] py-1 font-mono text-code leading-4.5 whitespace-pre">
      {shown.hunks.map((hunk) => (
        <Hunk key={`${hunk.oldStart}:${hunk.newStart}`} hunk={hunk} digits={digits} lit={lit} />
      ))}
    </div>
  );
}

interface CardProps {
  readonly root: string;
  readonly entry: ChangeEntry;
  readonly initial: boolean;
  readonly controller: FileSurfaceController;
  readonly ports: DiffSidesPorts;
  readonly colorize: ColorizeLines;
  /** The controller's read counter: a read that left the entry's counts alone can still change its text. */
  readonly reads: number;
  readonly marked: boolean;
}

const stampOf = (entry: ChangeEntry): string =>
  [entry.status, entry.oldPath, entry.added, entry.removed, entry.binary].join("\0");

function Card({ root, entry, initial, controller, ports, colorize, reads, marked }: CardProps) {
  const key = cardKey(root, entry.path);
  const folded = dockFoldedCards.value.has(key);
  const sides = useMemo(() => createDiffSides(ports), [ports]);
  const host = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(typeof IntersectionObserver === "undefined");
  // What the sides were last read for: unfolding, or scrolling back, must not read them again.
  const loadedFor = useRef<string | null>(null);

  useEffect(() => {
    const element = host.current;
    if (element === null || typeof IntersectionObserver === "undefined") {
      return;
    }
    const observer = new IntersectionObserver(
      (changes) => setNear(changes[changes.length - 1].isIntersecting),
      { rootMargin: NEAR_MARGIN },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => () => sides.clear(), [sides]);

  const tag = `${root}\0${stampOf(entry)}\0${initial}\0${reads}`;
  useEffect(() => {
    if (near && !folded && loadedFor.current !== tag) {
      loadedFor.current = tag;
      void sides.load({ root, entry, initial });
    }
    // `entry`, `root` and `initial` are read through `tag`: a snapshot that left this entry alone must not read again.
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- `tag` encodes root, entry stamp, initial and the read counter
  }, [near, folded, tag, sides]);

  const counts = countsFor(entry);
  const label = folded ? "Unfold" : "Fold";
  return (
    <div
      ref={host}
      data-card-path={entry.path}
      data-marked={marked ? "" : undefined}
      className={cn("border-b", marked && "shadow-[inset_2px_0_0_var(--primary)]")}
    >
      <div className="sticky top-0 z-10 flex h-7.5 items-center gap-1.5 border-b bg-sidebar pr-2.5 pl-1">
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`${label} ${entry.path}`}
          aria-expanded={!folded}
          onClick={() => toggleDockCardFold(key)}
        >
          <DeckIcon icon={folded ? ArrowRight01Icon : ArrowDown01Icon} />
        </Button>
        <StatusMark status={entry.status} />
        <Button
          variant="ghost"
          size="sm"
          title={entry.path}
          disabled={entry.status === "deleted"}
          className={cn(
            "h-auto min-w-0 rounded-sm px-1 py-0 text-xs hover:bg-transparent hover:underline focus-visible:bg-transparent",
            entry.status === "deleted" && "line-through",
          )}
          onClick={() =>
            void controller
              .openFile(root, absolutePath(root, entry.path), true)
              .then(selectDockFile)
          }
        >
          <span className="truncate">{baseName(entry.path)}</span>
        </Button>
        <span className="flex-1" />
        {counts.kind === "counts" ? (
          <ChangeCounts added={counts.added} removed={counts.removed} sans />
        ) : counts.kind === "binary" ? (
          <span className="shrink-0 text-xs text-muted-foreground">binary</span>
        ) : null}
      </div>
      {folded ? null : near || loadedFor.current !== null ? (
        <CardBody view={sides.view.value} colorize={colorize} />
      ) : null}
    </div>
  );
}

export interface DockChangesStackProps {
  readonly root: string;
  readonly entries: readonly ChangeEntry[];
  readonly initial: boolean;
  readonly controller: FileSurfaceController;
  readonly reads: number;
  /** The card a press in the list pane marked, or null. */
  readonly markedPath: string | null;
  /** Test seam; the window's file and git channels otherwise. */
  readonly ports?: DiffSidesPorts;
  /** Test seam; Monaco's colorizer otherwise. */
  readonly colorize?: ColorizeLines;
}

/**
 * The Changes view as one stack of per-file cards (DOCK-10). Every entry mounts its header; a
 * card reads its two sides only once it is within `NEAR_MARGIN` of the viewport, so a 65-file
 * stack loads a handful of bodies. The caller owns the scroller the sticky headers stick to.
 */
export function DockChangesStack({
  root,
  entries,
  initial,
  controller,
  reads,
  markedPath,
  ports = defaultStackPorts,
  colorize = colorizeLines,
}: DockChangesStackProps) {
  return (
    <div role="group" aria-label="File diffs">
      {entries.map((entry) => (
        <Card
          key={entry.path}
          root={root}
          entry={entry}
          initial={initial}
          controller={controller}
          ports={ports}
          colorize={colorize}
          reads={reads}
          marked={entry.path === markedPath}
        />
      ))}
    </div>
  );
}
