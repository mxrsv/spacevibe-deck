import { Folder, GitBranch, PushPin, TerminalWindow } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "preact/hooks";
import { cn } from "@/lib/cn";
import { AgentGlyph } from "../controls/agent-glyph";
import { CHROME_ICON, DeckIcon } from "../controls/deck-icon";
import { AgentStateMark } from "../blocks/agent-state-mark";
import { displayAgent } from "../agent-rail-card-model";
import { formatShortAge } from "../agent-rail-model";
import type { RailItem } from "../rail-view-model";
import type { RowCommands } from "./project-rail-commands";
import { isRailItemFocused, statusLabel } from "./project-rail-model";
import { ProjectRailRenameField } from "./project-rail-rename-field";
import { ProjectRailRowActions } from "./project-rail-row-actions";
import { railNow } from "./project-rail-state";

/** Time in the current state. Its own component so a clock tick wakes this text and no row. */
function StateAge({ changedAt }: { readonly changedAt: number }) {
  return <>{formatShortAge(changedAt, railNow.value)}</>;
}

export interface ProjectRailRowProps {
  readonly item: RailItem;
  /** The one row of the list Tab reaches; arrow keys move between the others. */
  readonly tabStop: boolean;
  readonly pinned: boolean;
  readonly commands: RowCommands;
  /** A row of the Archived section: its title is quieter. */
  readonly archived?: boolean;
  /** Set when the list is not grouped by project, so the row names its own project (LAY-3). */
  readonly projectName?: string;
  readonly onSelect: () => void;
}

/**
 * Two lines (LAY-2): the state and the title, then the agent, branch chip and time in state.
 * Hover or focus adds pin, archive and the more menu over the trailing edge; the same menu
 * opens on right-click. F2 or a double-click renames in place.
 */
export function ProjectRailRow({
  item,
  tabStop,
  pinned,
  commands,
  archived = false,
  projectName,
  onSelect,
}: ProjectRailRowProps) {
  const focused = isRailItemFocused(item);
  const { entry } = item;
  const { rename } = commands;
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const hit = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);

  // Unmounting the field drops focus to <body>; hand it back to the row. A press elsewhere
  // that ended the edit has already moved focus, so it stays.
  useEffect(() => {
    if (wasEditing.current && !editing && document.activeElement === document.body) {
      hit.current?.focus({ preventScroll: true });
    }
    wasEditing.current = editing;
  }, [editing]);

  return (
    <div
      data-rail-item={item.id}
      className="group/item relative mx-1.5"
      onContextMenu={(event: MouseEvent) => {
        // The field keeps the native menu (cut, copy, paste).
        if (!editing) {
          event.preventDefault();
          setMenuOpen(true);
        }
      }}
    >
      {editing && rename !== undefined ? (
        <div className="grid grid-cols-[10px_minmax(0,1fr)] items-center gap-x-2 rounded-md bg-accent px-2.5 py-1.5">
          <AgentStateMark status={item.status} confidence={item.confidence} />
          <ProjectRailRenameField
            initial={entry.kind === "agent" ? (entry.tabName ?? "") : ""}
            placeholder={entry.kind === "agent" ? (entry.taskLabel ?? entry.label) : item.title}
            onCommit={(name) => {
              setEditing(false);
              rename(name);
            }}
            onCancel={() => setEditing(false)}
          />
        </div>
      ) : (
        <>
          {/* raw-control: a whole-row click target; no Button variant spans a two-line row */}
          <button
            ref={hit}
            type="button"
            data-rail-row={item.id}
            tabIndex={tabStop ? 0 : -1}
            aria-current={focused ? "true" : undefined}
            onClick={onSelect}
            onDblClick={rename === undefined ? undefined : () => setEditing(true)}
            onKeyDown={(event: KeyboardEvent) => {
              if (event.key === "F2" && rename !== undefined) {
                event.preventDefault();
                setEditing(true);
              }
            }}
            className={cn(
              "grid w-full cursor-default grid-cols-[10px_minmax(0,1fr)] gap-x-2 gap-y-0.5 rounded-md px-2.5 py-1.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
              focused ? "bg-accent ring-1 ring-ring/40 ring-inset" : "hover:bg-accent/50",
            )}
          >
            <span className="flex h-[18px] items-center">
              <AgentStateMark status={item.status} confidence={item.confidence} />
            </span>
            <span
              className={cn(
                "truncate text-sm leading-[18px]",
                archived ? "text-muted-foreground" : "text-foreground",
                focused && "font-medium",
              )}
            >
              {item.title}
            </span>
            <span className="col-start-2 flex min-w-0 items-center gap-1.5 text-2xs leading-4 text-muted-foreground">
              {entry.kind === "agent" ? (
                <AgentGlyph agent={entry.agent} className="size-3 shrink-0" />
              ) : (
                <DeckIcon icon={TerminalWindow} size={CHROME_ICON} class="size-3 shrink-0" />
              )}
              {projectName === undefined ? null : (
                <span className="min-w-0 shrink truncate">{projectName}</span>
              )}
              <span className="inline-flex min-w-0 items-center gap-1 rounded-sm bg-muted px-1.5">
                <DeckIcon
                  icon={item.checkout.labelled ? GitBranch : Folder}
                  size={CHROME_ICON}
                  class="size-2.5 shrink-0"
                />
                <span className="truncate">{item.branch}</span>
              </span>
              <span className="ml-auto flex shrink-0 items-center gap-1 tabular-nums">
                {pinned ? <DeckIcon icon={PushPin} size={CHROME_ICON} class="size-2.5" /> : null}
                <StateAge changedAt={item.changedAt} />
              </span>
            </span>
            <span className="sr-only">
              {entry.kind === "agent" ? `${displayAgent(entry.agent)}, ` : "shell, "}
              {statusLabel(item)}
              {pinned ? ", pinned" : ""}
            </span>
          </button>
          <ProjectRailRowActions
            title={item.title}
            pinned={pinned}
            tabStop={tabStop}
            commands={commands}
            menuOpen={menuOpen}
            onMenuOpenChange={setMenuOpen}
            onRename={() => setEditing(true)}
          />
        </>
      )}
    </div>
  );
}
