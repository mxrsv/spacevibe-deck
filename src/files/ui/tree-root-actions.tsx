/**
 * The four actions of the explorer tab, hanging off the row that names what
 * the tab is showing (DL-19.9, design §4).
 *
 * This is the rail's own arrangement — `.asr-cluster__add` hangs a launcher off
 * a project header (DL-27.18) — with the one difference the owner asked for:
 * the cluster does NOT hide at rest. The hover-reveal was the drawn candidate
 * and was declined, which removes its single real cost: a column that showed no
 * actions until the pointer arrived.
 *
 * Each control is 17×17 and is deliberately NOT `.iconbtn` (design §4.2).
 * `.iconbtn` is 24×24, and four of them inside a 22px `.file-tree__row`
 * overflow it by 1px above and 1px below — measured on the gallery drawing,
 * 2026-08-25. `ROW_HEIGHT` is the constant every index in `FileTreeView` is
 * computed from, so the row cannot grow to fit the control; the control
 * shrinks instead. `.iconbtn`'s own missing `padding: 0` reset is therefore
 * not inherited here — but any future `.iconbtn` on this surface must still
 * declare it locally.
 */
import { useRef } from "preact/hooks";
import { ArrowClockwise, ArrowsInLineVertical, FilePlus, FolderPlus } from "@phosphor-icons/react";
import { CHROME_ICON, DeckIcon, type DeckIconComponent } from "../../ui/controls/deck-icon";
import {
  ActionTooltip,
  tooltipTriggerProps,
  useTooltipVisibility,
} from "../../ui/controls/action-tooltip";

export interface TreeRootActionsProps {
  /** Whether the running host can answer `create_entry` (design §6.4, §10). */
  readonly canCreate: boolean;
  /**
   * The root row's roving tab stop, mirrored (design §4.3). Tab enters the
   * tree once, lands on the root row and walks into these four; it never
   * offers eight tab stops inside a list that is meant to be one.
   */
  readonly tabIndex: 0 | -1;
  onNewFile(): void;
  onNewFolder(): void;
  onRefresh(): void;
  onCollapseAll(): void;
}

interface ClusterButtonProps {
  readonly id: string;
  readonly label: string;
  readonly icon: DeckIconComponent;
  readonly tabIndex: 0 | -1;
  onPress(): void;
}

function ClusterButton({ id, label, icon, tabIndex, onPress }: ClusterButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);
  // DL-23.10: an icon-only chrome control with an action draws the §23
  // tooltip and drops its native `title`. The name only — none of the four is
  // a keymap action, so there is no chord to show (DL-23.1's content rule).
  const tooltip = useTooltipVisibility();
  return (
    <>
      <button
        ref={ref}
        type="button"
        class="file-tree__action"
        aria-label={label}
        aria-describedby={tooltip.anchor === null ? undefined : id}
        tabIndex={tabIndex}
        onClick={(event) => {
          // Design §4.3: the row is a container plus a hit layer now. Without
          // this, pressing New File would ALSO toggle the root.
          event.stopPropagation();
          onPress();
        }}
        // A double-click on a control must not reach the row's own
        // double-click handler either.
        onDblClick={(event) => event.stopPropagation()}
        {...tooltipTriggerProps(tooltip, ref)}
      >
        <DeckIcon icon={icon} size={CHROME_ICON} />
      </button>
      {tooltip.anchor !== null && (
        <ActionTooltip
          id={id}
          label={label}
          shortcut={null}
          reason={null}
          anchor={tooltip.anchor}
        />
      )}
    </>
  );
}

export function TreeRootActions(props: TreeRootActionsProps) {
  return (
    <span class="file-tree__actions">
      {props.canCreate && (
        <>
          <ClusterButton
            id="file-tree-new-file"
            label="New file"
            icon={FilePlus}
            tabIndex={props.tabIndex}
            onPress={props.onNewFile}
          />
          <ClusterButton
            id="file-tree-new-folder"
            label="New folder"
            icon={FolderPlus}
            tabIndex={props.tabIndex}
            onPress={props.onNewFolder}
          />
        </>
      )}
      <ClusterButton
        id="file-tree-refresh"
        label="Refresh"
        icon={ArrowClockwise}
        tabIndex={props.tabIndex}
        onPress={props.onRefresh}
      />
      <ClusterButton
        id="file-tree-collapse-all"
        label="Collapse all"
        icon={ArrowsInLineVertical}
        tabIndex={props.tabIndex}
        onPress={props.onCollapseAll}
      />
    </span>
  );
}
