import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { useState } from "preact/hooks";
import { cn } from "@/lib/cn";
import { DeckIcon, GLYPH_INLINE, type DeckIconSize } from "../controls/deck-icon";
import { WorkspaceIcon } from "../workspace-icon";
import { stateClasses } from "../blocks/recipe-classes";
import type { RailGroup } from "../rail-view-model";
import { ProjectRailHeaderActions } from "./project-rail-header-actions";
import type { ProjectCommands } from "./project-rail-project-commands";
import { ProjectRailRemoveDialog } from "./project-rail-remove-dialog";

/** The `--icon-16` box of the header's mark. */
const PROJECT_MARK_PX = 16;
/** The fallback folder inside that box: 13, the smallest step a Phosphor icon draws at (RH-23). */
const FALLBACK_FOLDER_SIZE: DeckIconSize = 13;

export interface ProjectRailHeaderProps {
  readonly group: RailGroup;
  /** The folder the project's mark is looked up in: the repository, as the shipped rail does. */
  readonly markPath: string | null;
  readonly folded: boolean;
  readonly commands: ProjectCommands;
  /** The header the keyboard last stood on: its buttons are in the Tab order. */
  readonly active: boolean;
  readonly agentDisabled?: boolean;
  readonly onToggle: () => void;
}

/**
 * One project's header (LAY-1, SR-5): its logo, a short line to the name, the name and the fold
 * chevron. It sticks to the top of the scroll area while its rows pass under it. A FOLDED project
 * shows its agent count as a small circle on the logo's corner and nothing per status; an open
 * one shows its rows instead. Hover or focus adds "+" and the more menu; a press only folds.
 */
export function ProjectRailHeader({
  group,
  markPath,
  folded,
  commands,
  active,
  agentDisabled,
  onToggle,
}: ProjectRailHeaderProps) {
  const { count } = group;
  const sessions = `${count} ${count === 1 ? "session" : "sessions"}`;
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const { removal } = commands;
  return (
    <div
      data-rail-item={`project:${group.key}`}
      // Opaque, so the rows that scroll under the pinned header never show through it.
      className="group/item sticky top-0 z-1 bg-(--sidebar-bg)"
      onContextMenu={(event: MouseEvent) => {
        event.preventDefault();
        setMenuOpen(true);
      }}
    >
      {/* raw-control: a whole-row disclosure target; no Button variant spans a header row */}
      <button
        type="button"
        data-rail-project={group.key}
        aria-expanded={!folded}
        onClick={onToggle}
        className={cn(
          "flex h-(--row-28) w-full items-center gap-2 rounded-(--radius-control) px-(--space-pad-row) text-left",
          stateClasses(false),
        )}
      >
        <span className="relative inline-flex shrink-0">
          <WorkspaceIcon
            key={markPath}
            path={markPath}
            marks
            size={PROJECT_MARK_PX}
            fallbackSize={FALLBACK_FOLDER_SIZE}
            className="flex size-(--icon-16) shrink-0 items-center justify-center overflow-hidden rounded-(--radius-control) text-(--text-muted) [&>img]:size-full [&>img]:object-cover!"
          />
          {/* A short line joins the logo to the name across the gap between them (RH-9). */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-full flex w-(--space-8) justify-center"
          >
            <span className="h-(--seam-w) w-(--space-2) bg-(--seam-split)" />
          </span>
          {folded ? (
            <span
              aria-hidden="true"
              data-rail-count
              className="absolute -right-1 -bottom-1 grid h-(--badge-count-h) min-w-(--badge-count-h) place-items-center rounded-full bg-(--text-faint) px-0.5 text-(length:--type-rail-count) leading-none font-semibold text-(--bg) tabular-nums ring-2 ring-(--sidebar-bg)"
            >
              {count > 9 ? "9+" : count}
            </span>
          ) : null}
        </span>
        <span className="min-w-0 truncate text-(length:--type-meta) leading-(--leading-meta) font-semibold text-(--text-primary)">
          {group.label}
        </span>
        <DeckIcon
          icon={ArrowDown01Icon}
          size={GLYPH_INLINE}
          class={cn("shrink-0 text-(--text-faint) transition-transform", folded && "-rotate-90")}
        />
        <span className="sr-only">{sessions}</span>
      </button>
      <ProjectRailHeaderActions
        name={group.label}
        tabbable={active}
        commands={commands}
        agentDisabled={agentDisabled}
        menuOpen={menuOpen}
        onMenuOpenChange={setMenuOpen}
        onRemove={() => setConfirming(true)}
      />
      {removal === undefined ? null : (
        <ProjectRailRemoveDialog
          open={confirming}
          onOpenChange={setConfirming}
          name={group.label}
          tabCount={removal.tabCount}
          onConfirm={removal.run}
        />
      )}
    </div>
  );
}
