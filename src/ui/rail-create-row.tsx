import { FolderPlus, GitFork, Plus, type Icon } from "@phosphor-icons/react";
import { useEffect, useRef } from "preact/hooks";
import {
  ActionTooltip,
  tooltipTriggerProps,
  useTooltipVisibility,
} from "./controls/action-tooltip";
import { CHROME_ICON, DeckIcon } from "./controls/deck-icon";
import { createNewPaneDragController, type NewPaneDropDeps } from "./new-pane-drag";

/**
 * The create row (DL-27.14, amended 2026-10-09): `Agent`, `Worktree` and `Folder`,
 * the rail's only create controls.
 *
 * `row` is the expanded rail's three labelled buttons, with DL-23 tooltips that
 * name the target. `Agent` is the primary verb: it closes the row on the right,
 * where the eye ends, and wears the filled skin the stylesheet gives it. `column` is the collapsed rail's stack of icon buttons
 * (DL-27.29), which uses native `title`s like the avatars: a tooltip opening to
 * the right would paint over the browser's native view.
 *
 * State-free: the targets and what each press does belong to `RailCreate`. A verb
 * with no handler is omitted rather than drawn inert (DL-19.7). Only `Agent` is a
 * drag source, the same controller and ghost `+ New` used.
 */
export type RailCreateVariant = "row" | "column";

export interface RailCreateRowProps {
  readonly variant: RailCreateVariant;
  /** The tooltip (row) or the title and accessible name (column) of each verb. */
  readonly agentTitle: string;
  readonly worktreeTitle?: string;
  readonly folderTitle?: string;
  readonly disabled?: boolean;
  /** `Worktree`'s form is open: it names the popup it raises. */
  readonly worktreeOpen?: boolean;
  readonly newPaneDrop?: NewPaneDropDeps;
  onAgent(): void;
  onWorktree?(trigger: HTMLButtonElement): void;
  onFolder?(): void;
}

interface CreateButtonProps {
  readonly verb: string;
  readonly icon: Icon;
  readonly title: string;
  readonly variant: RailCreateVariant;
  readonly disabled?: boolean;
  readonly expanded?: boolean;
  readonly newPaneDrop?: NewPaneDropDeps;
  onPress(trigger: HTMLButtonElement): void;
}

function CreateButton({
  verb,
  icon,
  title,
  variant,
  disabled = false,
  expanded,
  newPaneDrop,
  onPress,
}: CreateButtonProps) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const dropRef = useRef<NewPaneDropDeps | undefined>(newPaneDrop);
  dropRef.current = newPaneDrop;
  const tooltip = useTooltipVisibility();
  const draggable = newPaneDrop !== undefined;
  const tooltipId = `rail-create-tip-${verb.toLowerCase()}`;

  useEffect(() => {
    const handle = buttonRef.current;
    if (!draggable || handle === null) {
      return;
    }
    const controller = createNewPaneDragController(handle, {
      ghostLabel: "New agent pane",
      slotRects: () => dropRef.current?.slotRects() ?? [],
      onDragStart: () => dropRef.current?.onDragStart?.(),
      onDrop: (targetPaneId, edge) => {
        dropRef.current?.onDrop(targetPaneId, edge);
      },
    });
    return () => controller.dispose();
  }, [draggable]);

  const column = variant === "column";
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        class="rail-create__button"
        data-verb={verb.toLowerCase()}
        disabled={disabled}
        aria-label={column ? title : undefined}
        title={column ? title : undefined}
        aria-haspopup={expanded === undefined ? undefined : "dialog"}
        aria-expanded={expanded}
        aria-describedby={!column && tooltip.anchor !== null ? tooltipId : undefined}
        {...(column ? {} : tooltipTriggerProps(tooltip, buttonRef))}
        onClick={(event) => {
          tooltip.close();
          onPress(event.currentTarget);
        }}
      >
        <DeckIcon icon={icon} size={CHROME_ICON} />
        {!column && <span>{verb}</span>}
      </button>
      {!column && tooltip.anchor !== null && (
        <ActionTooltip
          id={tooltipId}
          label={title}
          shortcut={null}
          reason={null}
          anchor={tooltip.anchor}
        />
      )}
    </>
  );
}

export function RailCreateRow(props: RailCreateRowProps) {
  const { variant, newPaneDrop } = props;
  // DOM order, not CSS `order`, so focus moves in the order the eye reads.
  const agent = (
    <CreateButton
      verb="Agent"
      icon={Plus}
      title={props.agentTitle}
      variant={variant}
      disabled={props.disabled}
      newPaneDrop={newPaneDrop}
      onPress={props.onAgent}
    />
  );
  const row = variant === "row";
  return (
    <div class="rail-create" data-variant={variant} role="group" aria-label="Create">
      {!row && agent}
      {props.onWorktree !== undefined && (
        <CreateButton
          verb="Worktree"
          icon={GitFork}
          title={props.worktreeTitle ?? "New worktree"}
          variant={variant}
          expanded={props.worktreeOpen === true}
          onPress={props.onWorktree}
        />
      )}
      {props.onFolder !== undefined && (
        <CreateButton
          verb="Folder"
          icon={FolderPlus}
          title={props.folderTitle ?? "Add a folder"}
          variant={variant}
          onPress={props.onFolder}
        />
      )}
      {row && agent}
    </div>
  );
}
