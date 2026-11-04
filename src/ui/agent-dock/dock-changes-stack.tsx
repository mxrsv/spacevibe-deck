import { ArrowDown01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { cn } from "@/lib/cn";
import { readHeadFile, type ChangeEntry } from "../../host/git-changes-host";
import { absolutePath, baseName, countsFor, STATUS_WORD } from "../../files/changes/changes-model";
import {
  createDiffSides,
  type DiffSidesPorts,
  type DiffSidesView,
} from "../../files/changes/diff-sides";
import { diffLines, type DiffHunk, type DiffLine } from "../../files/changes/line-diff";
import { defaultFileClient } from "../../files/file-client";
import type { FileSurfaceController } from "../../files/file-surface-controller";
import { ChangeCounts } from "../blocks/change-counts";
import { Button } from "../controls/button";
import { DeckIcon } from "../controls/deck-icon";
import { dockFoldedCards, selectDockFile, toggleDockCardFold } from "./agent-dock-state";
import { STATUS_LOOK } from "./dock-changes-tree";
import { DockChangesFileMenu, useFileMenu } from "./dock-changes-file-menu";

/** How far past the viewport a card starts reading its two sides. */
const NEAR_MARGIN = "600px 0px";

/** The sides' two reads over the window's real file and git channels. */
export const defaultStackPorts: DiffSidesPorts = {
  statFiles: (root, paths) => defaultFileClient.statFiles(root, paths),
  readFile: (root, path) => defaultFileClient.readFile(root, path),
  readHeadFile,
};

export const cardKey = (root: string, path: string): string => `${root}\0${path}`;

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

function CardBody({ view }: { view: DiffSidesView | null }) {
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

interface CardProps {
  readonly root: string;
  readonly entry: ChangeEntry;
  readonly initial: boolean;
  readonly controller: FileSurfaceController;
  readonly ports: DiffSidesPorts;
  /** The controller's read counter: a read that left the entry's counts alone can still change its text. */
  readonly reads: number;
  readonly marked: boolean;
}

const stampOf = (entry: ChangeEntry): string =>
  [entry.status, entry.oldPath, entry.added, entry.removed, entry.binary].join("\0");

function Card({ root, entry, initial, controller, ports, reads, marked }: CardProps) {
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
  const mark = STATUS_LOOK[entry.status];
  const label = folded ? "Unfold" : "Fold";
  const menu = useFileMenu();
  const openFile = (): void => {
    void controller.openFile(root, absolutePath(root, entry.path), true).then(selectDockFile);
  };
  return (
    <div
      ref={host}
      data-card-path={entry.path}
      data-marked={marked ? "" : undefined}
      className={cn("border-b", marked && "shadow-[inset_2px_0_0_var(--primary)]")}
    >
      <div
        className="sticky top-0 z-10 flex h-(--dock-row-h) items-center gap-1.5 border-b bg-sidebar pr-2.5 pl-1"
        {...menu.triggerProps}
      >
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`${label} ${entry.path}`}
          aria-expanded={!folded}
          onClick={() => toggleDockCardFold(key)}
        >
          <DeckIcon icon={folded ? ArrowRight01Icon : ArrowDown01Icon} />
        </Button>
        <span
          role="img"
          aria-label={STATUS_WORD[entry.status]}
          className={cn("w-3 shrink-0 text-center font-mono text-code font-semibold", mark.ink)}
        >
          {mark.letter}
        </span>
        <Button
          variant="ghost"
          size="sm"
          title={entry.path}
          disabled={entry.status === "deleted"}
          className={cn(
            "h-auto min-w-0 rounded-sm px-1 py-0 text-xs hover:bg-transparent hover:underline focus-visible:bg-transparent",
            entry.status === "deleted" && "line-through",
          )}
          onClick={openFile}
        >
          <span className="truncate">{baseName(entry.path)}</span>
        </Button>
        <span className="flex-1" />
        {counts.kind === "counts" ? (
          <ChangeCounts added={counts.added} removed={counts.removed} sans />
        ) : counts.kind === "binary" ? (
          <span className="shrink-0 text-xs text-muted-foreground">binary</span>
        ) : null}
        <DockChangesFileMenu
          root={root}
          entry={entry}
          open={menu.open}
          onOpenChange={menu.setOpen}
          onOpenFile={openFile}
        />
      </div>
      {folded ? null : near || loadedFor.current !== null ? (
        <CardBody view={sides.view.value} />
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
          reads={reads}
          marked={entry.path === markedPath}
        />
      ))}
    </div>
  );
}
