import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { useState } from "preact/hooks";
import { cn } from "@/lib/cn";
import { DeckIcon, GLYPH_INLINE } from "../controls/deck-icon";
import { WorkspaceIcon } from "../workspace-icon";
import { AgentStateMark } from "../blocks/agent-state-mark";
import { stateClasses } from "../blocks/recipe-classes";
import type { RailGroup } from "../rail-view-model";
import { ProjectRailHeaderActions } from "./project-rail-header-actions";
import { isWideGlyph, projectInitials, statusLabel } from "./project-rail-model";
import type { ProjectCommands } from "./project-rail-project-commands";
import { ProjectRailRemoveDialog } from "./project-rail-remove-dialog";

/** The `size-5` box of the header's mark. */
const PROJECT_MARK_PX = 20;

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
 * One project's header (LAY-1): its mark, name and fold chevron. A FOLDED project
 * speaks with its loudest agent and its count; an open one shows its rows instead. Hover or
 * focus adds "+" and the more menu (the count steps aside); a press only folds.
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
  const { rollup, count } = group;
  const initials = projectInitials(group.label);
  const sessions = `${count} ${count === 1 ? "session" : "sessions"}`;
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const { removal } = commands;
  return (
    <div
      data-rail-item={`project:${group.key}`}
      className="group/item relative"
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
          "flex h-(--row-32) w-full items-center gap-2 rounded-(--radius-control) px-(--space-pad-row) text-left",
          stateClasses(false),
        )}
      >
        <WorkspaceIcon
          key={markPath}
          path={markPath}
          marks
          size={PROJECT_MARK_PX}
          className="flex size-(--icon-box-24) shrink-0 overflow-hidden rounded-(--radius-control)"
          fallback={
            <span
              className={cn(
                "flex size-full items-center justify-center rounded-(--radius-control) bg-(--tab-rest-bg) text-xs leading-none text-(--text-muted) ring-1 ring-(--control-frame) ring-inset",
                isWideGlyph(initials) ? "font-normal" : "font-semibold",
              )}
            >
              {initials}
            </span>
          }
        />
        <span className="min-w-0 truncate text-sm font-semibold text-(--text-primary)">
          {group.label}
        </span>
        <DeckIcon
          icon={ArrowDown01Icon}
          size={GLYPH_INLINE}
          class={cn("shrink-0 text-(--text-faint) transition-transform", folded && "-rotate-90")}
        />
        {folded ? (
          <span className="ml-auto flex shrink-0 items-center gap-(--space-icon-label) text-xs leading-(--leading-meta) text-(--text-muted) tabular-nums group-hover/item:invisible group-has-[:focus-visible]/item:invisible group-has-[[data-popup-open]]/item:invisible">
            {rollup === null ? null : (
              <AgentStateMark status={rollup.status} confidence={rollup.confidence} />
            )}
            <span aria-hidden="true">{count}</span>
          </span>
        ) : null}
        <span className="sr-only">
          {sessions}
          {folded && rollup !== null ? `, ${statusLabel(rollup)}` : ""}
        </span>
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
