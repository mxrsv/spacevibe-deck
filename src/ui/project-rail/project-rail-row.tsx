import {
  ComputerTerminal01Icon,
  Folder01Icon,
  GitBranchIcon,
  Pin02Icon,
} from "@hugeicons/core-free-icons";
import { useEffect, useRef, useState } from "preact/hooks";
import { cn } from "@/lib/cn";
import { AgentGlyph } from "../controls/agent-glyph";
import { DeckIcon, GLYPH_INLINE } from "../controls/deck-icon";
import { STATE_NEEDS_YOU, stateClasses } from "../blocks/recipe-classes";
import { displayAgent } from "../agent-rail-card-model";
import { formatShortAge } from "../agent-rail-model";
import type { RailItem, RailStatus } from "../rail-view-model";
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
 * The two-line rail row (SR-1, RCP-7): 32 high, no status mark (SR-3), the agent's 16 logo box
 * holding a 12 glyph, then the title over the meta line 8 after the box, so the text starts where
 * the workspace name does. Shared with the remembered variant (`remembered-row.tsx`).
 */
export const ROW_LAYOUT =
  "flex h-(--row-32) w-full min-w-0 items-center gap-2 rounded-(--radius-control) px-(--space-pad-row) text-left";
/** The agent's logo in a 16 box. */
export const ROW_LOGO = "flex size-(--icon-16) shrink-0 items-center justify-center";
/** The title over the meta line. */
export const ROW_MAIN = "flex min-w-0 flex-1 flex-col";
/** The 11px title (RH-12); weight and ink are the row's. */
export const ROW_TITLE = "truncate text-(length:--type-rail-title) leading-(--leading-rail-line)";
/** The 10px meta line under the title; a row sets its ink (RH-21). */
export const ROW_META =
  "flex min-w-0 items-center gap-(--space-icon-label) text-(length:--type-rail-meta) leading-(--leading-rail-line) text-(--text-faint)";

/**
 * The meta line's ink per status (RH-21): the branch icon and the branch take it, the date keeps
 * the faint ink. With no mark in the row this is how a status reads next to the title's weight.
 */
const META_INK: Readonly<Record<RailStatus, string>> = {
  "needs-input": "text-(--ink-need)",
  unread: "text-(--ink-need)",
  failed: "text-(--ink-fail)",
  done: "text-(--ink-ok)",
  working: "text-(--status-working)",
  ended: "text-(--text-faint)",
  idle: "text-(--text-faint)",
};

/** What the meta line says where git has no branch to give (RH-24). */
const FOLDER_ONLY = "folder only";

/** The agent's logo, or the terminal glyph of a shell tab, in the logo box. */
export function RowLogo({
  entry,
  className,
}: {
  readonly entry: RailItem["entry"];
  readonly className?: string;
}) {
  return (
    <span className={cn(ROW_LOGO, className)}>
      {entry.kind === "agent" ? (
        <AgentGlyph agent={entry.agent} className="size-(--icon-12) shrink-0" />
      ) : (
        <DeckIcon icon={ComputerTerminal01Icon} size={GLYPH_INLINE} class="shrink-0" />
      )}
    </span>
  );
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
 * Two lines (LAY-2, SR-1): the agent's logo, then the title over the branch (and the project, in
 * a flat list) and the time in state. There is no mark: an unread or needs-you title is 600, the
 * branch icon and text take the status ink (SR-4), a needs-you row carries the tint (RCP-9), and
 * a working row's branch is a thinking line with three dots for its date. A workspace without git
 * says "folder only" (SR-6). Hover or focus adds pin, archive and the more menu over the trailing
 * edge on an opaque ground (RCP-19); the same menu opens on right-click. F2 or a double-click
 * renames in place.
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
  const working = item.status === "working";
  // Unread and needs-you are the rows the owner scans for: their title is 600 (SR-2).
  const loud = item.status === "needs-input" || item.status === "unread";
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
          <RowLogo entry={entry} />
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
            <RowLogo entry={entry} />
            <span className={ROW_MAIN}>
              <span
                data-rail-title
                className={cn(
                  ROW_TITLE,
                  archived ? "text-(--text-muted)" : "text-(--text-primary)",
                  loud && "font-semibold",
                )}
              >
                {item.title}
              </span>
              <span data-rail-meta className={cn(ROW_META, META_INK[item.status])}>
                {projectName === undefined ? null : (
                  <span className="min-w-0 shrink truncate">{projectName}</span>
                )}
                <DeckIcon
                  icon={item.checkout.labelled ? GitBranchIcon : Folder01Icon}
                  size={GLYPH_INLINE}
                  class="shrink-0"
                />
                <span className={cn("min-w-0 truncate", working && "rail-thinking")}>
                  {item.checkout.labelled ? item.branch : FOLDER_ONLY}
                </span>
                <span className="ml-auto flex shrink-0 items-center gap-1 text-(--text-faint)">
                  {pinned ? <DeckIcon icon={Pin02Icon} size={GLYPH_INLINE} /> : null}
                  {working ? (
                    <span className="rail-dots" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                    </span>
                  ) : (
                    <StateAge changedAt={item.changedAt} />
                  )}
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
