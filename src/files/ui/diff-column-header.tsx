/**
 * The diff column's header (plan 2026-10-10-diff-column, DIFF3, D4, D5): the
 * file's status mark, name and counts, its place in the list, and four
 * icon-only controls with DL-23.10 tooltips (DL-19.11). The directory and the status word
 * live in tooltips, and the name is the one item that shrinks.
 */
import { useRef } from "preact/hooks";
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  ArrowUpRight01Icon,
  Cancel01Icon,
} from "@hugeicons/core-free-icons";
import { DeckIcon, type DeckGlyph } from "../../ui/controls/deck-icon";
import {
  ActionTooltip,
  tooltipTriggerProps,
  useTooltipVisibility,
} from "../../ui/controls/action-tooltip";
import type { ChangeEntry } from "../../host/git-changes-host";
import {
  baseName,
  countsFor,
  dirName,
  entryTitle,
  STATUS_MARK,
  STATUS_WORD,
} from "../changes/changes-model";
import { DiffCounts } from "./changes-list";

export interface DiffColumnHeaderProps {
  /** Null once the file is no longer in the list; the name then comes from `path`. */
  readonly entry: ChangeEntry | null;
  readonly path: string;
  /** "2/5" while the file is listed. */
  readonly position: string | null;
  /** DOM id prefix for the tooltips. */
  readonly id: string;
  onPrevious: (() => void) | null;
  onNext: (() => void) | null;
  /** Null where there is no working file to open (a deleted entry). */
  onOpenFile: (() => void) | null;
  onClose(): void;
}

interface HeadActionProps {
  readonly id: string;
  readonly icon: DeckGlyph;
  readonly label: string;
  /** The key shown in the tooltip, when the control has one. */
  readonly shortcut: string | null;
  /** Why the control does nothing, or null while it works. */
  readonly unavailable?: string;
  onPress: (() => void) | null;
}

function HeadAction(props: HeadActionProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const tooltip = useTooltipVisibility();
  const reason = props.unavailable ?? null;
  return (
    <>
      <button
        ref={ref}
        type="button"
        class="iconbtn diff-column__btn"
        aria-label={props.label}
        aria-disabled={reason === null ? undefined : true}
        aria-describedby={tooltip.anchor === null ? undefined : props.id}
        onClick={() => {
          if (reason === null) {
            props.onPress?.();
          }
        }}
        {...tooltipTriggerProps(tooltip, ref)}
      >
        <DeckIcon icon={props.icon} />
      </button>
      {tooltip.anchor !== null && (
        <ActionTooltip
          id={props.id}
          label={props.label}
          shortcut={props.shortcut}
          reason={reason}
          anchor={tooltip.anchor}
        />
      )}
    </>
  );
}

/** A rename shows `old → new`; every other status shows the name alone. */
function headName(entry: ChangeEntry | null, path: string): string {
  if (entry?.status === "renamed" && entry.oldPath !== null) {
    return `${baseName(entry.oldPath)} → ${baseName(entry.path)}`;
  }
  return baseName(path);
}

export function DiffColumnHeader(props: DiffColumnHeaderProps) {
  const { entry, path } = props;
  const counts = entry === null ? null : countsFor(entry);
  const tooltip = entry !== null && dirName(path) === "" ? entryTitle(entry) : path;
  return (
    <header class="diff-column__head">
      {entry !== null && (
        <span class="changes-row__mark" title={STATUS_WORD[entry.status]} aria-hidden="true">
          {STATUS_MARK[entry.status]}
        </span>
      )}
      <span class="diff-column__name" title={tooltip}>
        {headName(entry, path)}
      </span>
      {counts?.kind === "counts" && (
        <span class="diff-column__counts">
          <DiffCounts added={counts.added} removed={counts.removed} />
        </span>
      )}
      {props.position !== null && (
        <span class="diff-column__position" title="Position in the list">
          {props.position}
        </span>
      )}
      <HeadAction
        id={`${props.id}-previous`}
        icon={ArrowLeft01Icon}
        label="Previous file"
        shortcut="["
        unavailable={props.onPrevious === null ? "This is the first file" : undefined}
        onPress={props.onPrevious}
      />
      <HeadAction
        id={`${props.id}-next`}
        icon={ArrowRight01Icon}
        label="Next file"
        shortcut="]"
        unavailable={props.onNext === null ? "This is the last file" : undefined}
        onPress={props.onNext}
      />
      {props.onOpenFile !== null && (
        <HeadAction
          id={`${props.id}-open`}
          icon={ArrowUpRight01Icon}
          label="Open file"
          shortcut={null}
          onPress={props.onOpenFile}
        />
      )}
      <HeadAction
        id={`${props.id}-close`}
        icon={Cancel01Icon}
        label="Close"
        shortcut="Esc"
        onPress={props.onClose}
      />
    </header>
  );
}
