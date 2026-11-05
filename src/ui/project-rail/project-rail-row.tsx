import {
  ComputerTerminal01Icon,
  Folder01Icon,
  GitBranchIcon,
  Pin02Icon,
} from "@hugeicons/core-free-icons";
import { useEffect, useRef, useState } from "preact/hooks";
import { cn } from "@/lib/cn";
import { AgentGlyph } from "../controls/agent-glyph";
import { DeckIcon, GLYPH_FEATURE, GLYPH_INLINE } from "../controls/deck-icon";
import { AgentStateMark } from "../blocks/agent-state-mark";
import { STATE_NEEDS_YOU, stateClasses } from "../blocks/recipe-classes";
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

/**
 * The two-line rail row (RCP-7, RCP-18): 44 high, the state mark leading in its 14 slot, the
 * agent's 28 logo box, then the title over the meta line. Shared with the remembered variant
 * (`remembered-row.tsx`), whose empty slot keeps the titles in line.
 */
export const ROW_LAYOUT =
  "flex h-(--row-40) w-full min-w-0 items-center gap-2 rounded-(--radius-control) px-(--space-pad-row) text-left";
/** The leading mark's 14 slot; it gives back 4 of the gap, as the mock's `.row-lead` does. */
export const ROW_LEAD = "-mr-1 flex size-(--mark-slot) shrink-0 items-center justify-center";
/** The agent's logo in a 28 box. */
export const ROW_LOGO = "flex size-(--icon-box-28) shrink-0 items-center justify-center";
/** The title over the meta line. */
export const ROW_MAIN = "flex min-w-0 flex-1 flex-col";
/** The 12px meta line under the title. */
export const ROW_META =
  "flex min-w-0 items-center gap-(--space-icon-label) text-xs leading-(--leading-meta) text-(--text-faint)";

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
 * Two lines (LAY-2, RCP-18): the state mark, the agent's logo, then the title over the branch
 * (and the project, in a flat list) and the time in state. A failed row's meta line reads in fail
 * ink, and a row that needs the user carries the needs-you tint and a 600 title (RCP-9). Hover or
 * focus adds pin, archive and the more menu over the trailing edge on an opaque ground (RCP-19);
 * the same menu opens on right-click. F2 or a double-click renames in place.
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
      className="group/item relative"
      onContextMenu={(event: MouseEvent) => {
        // The field keeps the native menu (cut, copy, paste).
        if (!editing) {
          event.preventDefault();
          setMenuOpen(true);
        }
      }}
    >
      {editing && rename !== undefined ? (
        <div className={cn(ROW_LAYOUT, "bg-(--tab-active-bg)")}>
          <span className={ROW_LEAD}>
            <AgentStateMark status={item.status} confidence={item.confidence} />
          </span>
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
              ROW_LAYOUT,
              stateClasses(focused),
              item.status === "needs-input" && !focused && STATE_NEEDS_YOU,
            )}
          >
            <span className={ROW_LEAD}>
              <AgentStateMark status={item.status} confidence={item.confidence} />
            </span>
            <span className={ROW_LOGO}>
              {entry.kind === "agent" ? (
                <AgentGlyph agent={entry.agent} className="size-(--icon-16) shrink-0" />
              ) : (
                <DeckIcon icon={ComputerTerminal01Icon} size={GLYPH_FEATURE} class="shrink-0" />
              )}
            </span>
            <span className={ROW_MAIN}>
              <span
                className={cn(
                  "truncate text-(length:--type-rail) leading-(--leading-rail)",
                  archived ? "text-(--text-muted)" : "text-(--text-primary)",
                  item.status === "needs-input" && "font-semibold",
                )}
              >
                {item.title}
              </span>
              <span className={cn(ROW_META, item.status === "failed" && "text-(--ink-fail)")}>
                {projectName === undefined ? null : (
                  <span className="min-w-0 shrink truncate">{projectName}</span>
                )}
                <DeckIcon
                  icon={item.checkout.labelled ? GitBranchIcon : Folder01Icon}
                  size={GLYPH_INLINE}
                  class="shrink-0"
                />
                <span className="min-w-0 truncate">{item.branch}</span>
                <span className="ml-auto flex shrink-0 items-center gap-1 tabular-nums">
                  {pinned ? <DeckIcon icon={Pin02Icon} size={GLYPH_INLINE} /> : null}
                  <StateAge changedAt={item.changedAt} />
                </span>
              </span>
            </span>
            <span className="sr-only">
              {entry.kind === "agent" ? `${displayAgent(entry.agent)}, ` : "shell, "}
              {statusLabel(item)}
              {pinned ? ", pinned" : ""}
            </span>
          </button>
          <ProjectRailRowActions
            selected={focused}
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
