import { CaretDown, CaretRight } from "@phosphor-icons/react";
import { useState } from "preact/hooks";
import { cn } from "@/lib/cn";
import type { ChangeEntry, ChangeStatus } from "../../host/git-changes-host";
import { baseName, countsFor, STATUS_WORD } from "../../files/changes/changes-model";
import {
  buildChangesTree,
  fileKey,
  folderKey,
  visibleRows,
  type ChangeFolder,
} from "../../files/changes/changes-tree-model";
import { ChangeCounts } from "../blocks/change-counts";
import { CHROME_ICON, DeckIcon } from "../controls/deck-icon";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../controls/collapsible";

const INDENT = 10;
const STEP = 14;
const ROW =
  "flex h-7 w-full items-center gap-1.5 pr-3 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

/** A file's mark and its ink: new files read as added, rewritten ones as modified. */
const STATUS_LOOK: Readonly<Record<ChangeStatus, { letter: string; ink: string }>> = {
  modified: { letter: "M", ink: "text-(--term-warn)" },
  added: { letter: "A", ink: "text-(--term-ok)" },
  deleted: { letter: "D", ink: "text-(--term-err)" },
  renamed: { letter: "R", ink: "text-(--term-warn)" },
  untracked: { letter: "U", ink: "text-(--term-ok)" },
};

export interface DockChangesTreeProps {
  readonly entries: readonly ChangeEntry[];
  /** The path whose diff is open, or null. */
  readonly selectedPath: string | null;
  /** Opens one entry's diff, as a row of the legacy Changes list does. */
  onOpen(entry: ChangeEntry): void;
}

interface TreeState {
  readonly closed: ReadonlySet<string>;
  readonly tabStop: string | undefined;
  readonly selectedPath: string | null;
  toggle(path: string): void;
  onOpen(entry: ChangeEntry): void;
  onFocus(key: string): void;
}

function FileRow({ entry, depth, tree }: { entry: ChangeEntry; depth: number; tree: TreeState }) {
  const key = fileKey(entry);
  const selected = entry.path === tree.selectedPath;
  const counts = countsFor(entry);
  const mark = STATUS_LOOK[entry.status];
  return (
    <>
      {/* raw-control: a whole-row press target; no Button variant spans a tree row */}
      <button
        type="button"
        data-change-row={key}
        tabIndex={tree.tabStop === key ? 0 : -1}
        aria-current={selected ? "true" : undefined}
        onClick={() => tree.onOpen(entry)}
        onFocus={() => tree.onFocus(key)}
        style={{ paddingLeft: INDENT + depth * STEP + 18 }}
        className={cn(ROW, "gap-2", selected && "bg-muted")}
      >
        <span
          role="img"
          aria-label={STATUS_WORD[entry.status]}
          className={cn("w-3 shrink-0 text-center font-mono text-code font-semibold", mark.ink)}
        >
          {mark.letter}
        </span>
        <span
          className={cn(
            "min-w-0 flex-1 truncate font-mono text-code",
            entry.status === "deleted" ? "text-muted-foreground line-through" : "text-foreground",
          )}
        >
          {baseName(entry.path)}
          {entry.status === "renamed" && entry.oldPath !== null ? (
            <span className="sr-only"> (from {entry.oldPath})</span>
          ) : null}
        </span>
        {counts.kind === "counts" ? (
          <ChangeCounts added={counts.added} removed={counts.removed} />
        ) : counts.kind === "binary" ? (
          <span className="shrink-0 text-2xs text-muted-foreground">binary</span>
        ) : null}
      </button>
    </>
  );
}

function FolderRow({
  folder,
  depth,
  tree,
}: {
  folder: ChangeFolder;
  depth: number;
  tree: TreeState;
}) {
  const key = folderKey(folder);
  const open = !tree.closed.has(folder.path);
  return (
    <Collapsible open={open} onOpenChange={() => tree.toggle(folder.path)}>
      <CollapsibleTrigger
        data-change-row={key}
        tabIndex={tree.tabStop === key ? 0 : -1}
        onFocus={() => tree.onFocus(key)}
        style={{ paddingLeft: INDENT + depth * STEP }}
        className={ROW}
      >
        <span className="text-muted-foreground">
          <DeckIcon icon={open ? CaretDown : CaretRight} size={CHROME_ICON} />
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-code text-foreground">
          {folder.label}
        </span>
        <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
          {folder.fileCount}
        </span>
        <ChangeCounts added={folder.added} removed={folder.removed} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <Rows folder={folder} depth={depth + 1} tree={tree} />
      </CollapsibleContent>
    </Collapsible>
  );
}

function Rows({ folder, depth, tree }: { folder: ChangeFolder; depth: number; tree: TreeState }) {
  return (
    <>
      {folder.folders.map((child) => (
        <FolderRow key={folderKey(child)} folder={child} depth={depth} tree={tree} />
      ))}
      {folder.files.map((entry) => (
        <FileRow key={fileKey(entry)} entry={entry} depth={depth} tree={tree} />
      ))}
    </>
  );
}

/**
 * The changed files as folders with roll-up counts (LAY-6). One row is a Tab stop and the arrow
 * keys walk the rest, as the legacy list's roving tabindex does; Enter and Space press a row.
 */
export function DockChangesTree({ entries, selectedPath, onOpen }: DockChangesTreeProps) {
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const [focused, setFocused] = useState<string | null>(null);
  const root = buildChangesTree(entries);
  const rows = visibleRows(root, closed);
  const tabStop = rows.find((row) => row.key === focused)?.key ?? rows[0]?.key;

  const toggle = (path: string): void => {
    const next = new Set(closed);
    if (!next.delete(path)) {
      next.add(path);
    }
    setClosed(next);
  };

  function onKeyDown(event: KeyboardEvent): void {
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
      return;
    }
    const target = event.target;
    const key = target instanceof HTMLElement ? target.getAttribute("data-change-row") : null;
    const at = rows.findIndex((row) => row.key === key);
    if (at === -1) {
      return;
    }
    const row = rows[at];
    const move = (to: number): void => {
      const next = rows[Math.max(0, Math.min(rows.length - 1, to))];
      event.preventDefault();
      setFocused(next.key);
      [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>("[data-change-row]")]
        .find((candidate) => candidate.getAttribute("data-change-row") === next.key)
        ?.focus();
    };
    if (event.key === "ArrowDown") {
      move(at + 1);
    } else if (event.key === "ArrowUp") {
      move(at - 1);
    } else if (event.key === "Home") {
      move(0);
    } else if (event.key === "End") {
      move(rows.length - 1);
    } else if (row.kind === "folder" && event.key === "ArrowRight" && closed.has(row.folder.path)) {
      event.preventDefault();
      toggle(row.folder.path);
    } else if (row.kind === "folder" && event.key === "ArrowLeft" && !closed.has(row.folder.path)) {
      event.preventDefault();
      toggle(row.folder.path);
    }
  }

  const tree: TreeState = { closed, tabStop, selectedPath, toggle, onOpen, onFocus: setFocused };
  return (
    <div role="group" aria-label="Changed files" onKeyDown={onKeyDown}>
      <Rows folder={root} depth={0} tree={tree} />
    </div>
  );
}
