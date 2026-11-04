import { ArrowDown01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { cn } from "@/lib/cn";
import { readHeadFile, type ChangeEntry } from "../../host/git-changes-host";
import {
  absolutePath,
  baseName,
  countsFor,
  dirName,
  STATUS_WORD,
} from "../../files/changes/changes-model";
import { createDiffSides, type DiffSidesPorts } from "../../files/changes/diff-sides";
import { defaultFileClient } from "../../files/file-client";
import type { FileSurfaceController } from "../../files/file-surface-controller";
import { ChangeCounts } from "../blocks/change-counts";
import { Button } from "../controls/button";
import { DeckIcon } from "../controls/deck-icon";
import { cardKey, dockFoldedCards, selectDockFile, toggleDockCardFold } from "./agent-dock-state";
import { CardBody } from "./dock-changes-card-body";
import { DockChangesFileMenu, useFileMenu } from "./dock-changes-file-menu";

/** How far past the viewport a card starts reading its two sides. */
const NEAR_MARGIN = "600px 0px";

/** The sides' two reads over the window's real file and git channels. */
export const defaultStackPorts: DiffSidesPorts = {
  statFiles: (root, paths) => defaultFileClient.statFiles(root, paths),
  readFile: (root, path) => defaultFileClient.readFile(root, path),
  readHeadFile,
};

interface CardProps {
  readonly root: string;
  readonly entry: ChangeEntry;
  readonly initial: boolean;
  readonly controller: FileSurfaceController;
  readonly ports: DiffSidesPorts;
  /** The controller's read counter: a read that left the entry's counts alone can still change its text. */
  readonly reads: number;
}

/**
 * The header's repo-relative path, clipped from the left so the file name always shows in full:
 * the folder part is muted and gives way first, the name keeps the button's weight. The folder
 * clips inside an RTL box so the ellipsis lands on the left; its text stays an LTR run, or a
 * leading dot (`.github/…`) would move to the end.
 */
function CardPath({ entry }: { entry: ChangeEntry }) {
  const folder = dirName(entry.path);
  return (
    <>
      {folder === "" ? null : (
        <>
          <span dir="rtl" className="min-w-0 truncate text-left font-normal text-muted-foreground">
            <bdi dir="ltr">{folder}</bdi>
          </span>
          <span className="shrink-0 font-normal text-muted-foreground">/</span>
        </>
      )}
      <span
        className={cn(
          "max-w-full shrink-0 truncate",
          entry.status === "deleted" && "text-muted-foreground line-through",
        )}
      >
        {baseName(entry.path)}
      </span>
      <span className="sr-only"> ({STATUS_WORD[entry.status]})</span>
    </>
  );
}

const stampOf = (entry: ChangeEntry): string =>
  [entry.status, entry.oldPath, entry.added, entry.removed, entry.binary].join("\0");

function Card({ root, entry, initial, controller, ports, reads }: CardProps) {
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
  const menu = useFileMenu();
  const absolute = absolutePath(root, entry.path);
  // One press on the path is a preview tab (DOCK-6); the menu's Open keeps the tab.
  const preview = (): void => {
    void controller.openFile(root, absolute, false).then(selectDockFile);
  };
  const keep = (): void => {
    void controller.openFile(root, absolute, true).then(selectDockFile);
  };
  return (
    <div
      ref={host}
      data-card-path={entry.path}
      // `data-flash` is set and cleared by the Changes view on a list press, outside rendering.
      className="border-b data-flash:shadow-[inset_2px_0_0_var(--primary)]"
    >
      <div
        className="sticky top-0 z-10 box-border flex h-(--dock-row-h) items-center gap-1.5 border-b bg-sidebar pr-2.5 pl-1"
        // `box-border`: the row height includes the bottom rule, as a list row's does; there is
        // no global box-sizing reset. The path button `shrink`s so its folder part can clip.
        // The header's one verb is the fold: a press anywhere but on a button folds the card. The
        // chevron folds on its own press, which is the keyboard's way in; the path opens instead.
        onClick={(event) => {
          if ((event.target as Element).closest("button") === null) {
            toggleDockCardFold(key);
          }
        }}
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
        <Button
          variant="ghost"
          size="sm"
          title={entry.path}
          disabled={entry.status === "deleted"}
          className="h-auto min-w-0 shrink gap-0 rounded-sm px-1 py-0 text-xs hover:bg-transparent hover:underline focus-visible:bg-transparent"
          onClick={preview}
        >
          <CardPath entry={entry} />
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
          onOpenFile={keep}
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
        />
      ))}
    </div>
  );
}
