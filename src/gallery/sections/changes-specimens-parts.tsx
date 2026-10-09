/**
 * The pieces the three Changes variants share: a changed-file row, the
 * `+N −M` counts, the branch label and the 17px Refresh control.
 *
 * Counts are neutral (C9 a): muted ink, tabular figures (DL-4.2), no green or
 * red. A status is a one-letter mark with its word in the tooltip.
 */
import { ArrowClockwise, GitBranch } from "@phosphor-icons/react";
import { CHROME_ICON, DeckIcon, ROW_ICON } from "../../ui/controls/deck-icon";
import {
  BRANCH,
  COMPARISON,
  STATUS_MARK,
  changeTooltip,
  splitPath,
  type ChangeEntry,
  type Totals,
} from "./changes-specimens-data";

export function Counts({ added, removed }: Totals) {
  return (
    <span class="chgx-counts">
      <span>+{added}</span> <span>−{removed}</span>
    </span>
  );
}

/** A binary file says so instead of counting lines (CHG1). */
export function EntryCounts({ entry }: { readonly entry: ChangeEntry }) {
  return entry.status === "binary" ? (
    <span class="chgx-counts">binary</span>
  ) : (
    <Counts added={entry.added} removed={entry.removed} />
  );
}

export function StatusMark({ entry }: { readonly entry: ChangeEntry }) {
  return (
    <span class="chgx-mark" aria-hidden="true">
      {STATUS_MARK[entry.status]}
    </span>
  );
}

/** One 22px row of the flat list (variants A and B). A deleted file is shown
 * and not pressable (C8): there is nothing in the working tree to open. */
export function ChangeRow({ entry }: { readonly entry: ChangeEntry }) {
  const { name, dir } = splitPath(entry.path);
  const deleted = entry.status === "deleted";
  return (
    <div
      class={`chgx-row${deleted ? " is-deleted" : ""}`}
      role="listitem"
      tabIndex={deleted ? undefined : 0}
      title={changeTooltip(entry)}
    >
      <StatusMark entry={entry} />
      <span class="chgx-row__name">{name}</span>
      <span class="chgx-row__dir">
        {entry.oldPath === undefined ? dir : `← ${splitPath(entry.oldPath).name}`}
      </span>
      <EntryCounts entry={entry} />
    </div>
  );
}

/** The 17px Refresh control, the tree root's own (DL-19.9) so the variants
 * differ in placement and not in the control. */
export function RefreshButton() {
  return (
    <button type="button" class="file-tree__action" aria-label="Refresh changes">
      <DeckIcon icon={ArrowClockwise} size={CHROME_ICON} />
    </button>
  );
}

export function BranchLabel({ muted = false }: { readonly muted?: boolean }) {
  return (
    <span class={`chgx-branch${muted ? " is-muted" : ""}`} title={`${BRANCH}\n${COMPARISON}`}>
      <span class="chgx-branch__icon">
        <DeckIcon icon={GitBranch} size={ROW_ICON} />
      </span>
      <span class="chgx-branch__name">{BRANCH}</span>
    </span>
  );
}

/** CHG4's empty state: an explicit line, not a blank list. */
export function EmptyState() {
  return <p class="chgx-empty">No changes against HEAD</p>;
}

/** DL-19.5's status line, as `ExplorerTab` draws it. */
export function StatusLine({ failed, children }: { children: string; failed: boolean }) {
  return (
    <p class={`file-tree-shell__status${failed ? " is-failure" : ""}`} role="status">
      {children}
    </p>
  );
}

export const TIMEOUT_MESSAGE = "git status took longer than 10 s. Showing the last result.";
