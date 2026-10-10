/**
 * The Changes side of the Explorer (variant A, spec CHG1, CHG4): the branch row
 * with its totals and Refresh, then one 22px row per changed file.
 *
 * A row is status, name, directory and counts. Counts are tabular (DL-4.2) and
 * wear the diff's colours (DL-3.2, plan C9). A binary file says so
 * instead of counting. Pressing a row opens the working-tree file in the preview
 * tab, as a tree click does (plan C8); a deleted file has nothing to open, so its
 * row is shown, not pressable. Slice 2 replaces the press with the diff column.
 *
 * Keyboard reach is the tree's roving tabindex: one row is a tab stop, arrows
 * move it, Enter and Space press it.
 */
import { useRef, useState } from "preact/hooks";
import { ArrowClockwise, GitBranch } from "@phosphor-icons/react";
import { CHROME_ICON, DeckIcon, ROW_ICON } from "../../ui/controls/deck-icon";
import {
  ActionTooltip,
  tooltipTriggerProps,
  useTooltipVisibility,
} from "../../ui/controls/action-tooltip";
import type { ChangeEntry } from "../../host/git-changes-host";
import type { ChangesState } from "../changes/changes-controller";
import {
  baseName,
  branchLabel,
  comparisonLabel,
  countsFor,
  dirName,
  entryTitle,
  omittedLabel,
  STATUS_MARK,
} from "../changes/changes-model";

export interface ChangesListProps {
  readonly state: ChangesState;
  /** Opens one entry's working-tree file in the preview tab. */
  onOpen(entry: ChangeEntry): void;
  onRefresh(): void;
}

/**
 * `+N −M` with added lines in `--green` and removed lines in `--red` (DL-3.2).
 * A zero side keeps the count's neutral ink, so colour only marks a change.
 */
export function DiffCounts(props: { readonly added: number; readonly removed: number }) {
  return (
    <>
      <span class={props.added > 0 ? "diff-counts__added" : undefined}>+{props.added}</span>{" "}
      <span class={props.removed > 0 ? "diff-counts__removed" : undefined}>−{props.removed}</span>
    </>
  );
}

function RefreshButton({ onPress }: { onPress(): void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const tooltip = useTooltipVisibility();
  return (
    <>
      <button
        ref={ref}
        type="button"
        class="file-tree__action"
        aria-label="Refresh changes"
        aria-describedby={tooltip.anchor === null ? undefined : "changes-refresh"}
        onClick={onPress}
        {...tooltipTriggerProps(tooltip, ref)}
      >
        <DeckIcon icon={ArrowClockwise} size={CHROME_ICON} />
      </button>
      {tooltip.anchor !== null && (
        <ActionTooltip
          id="changes-refresh"
          label="Refresh changes"
          shortcut={null}
          reason={null}
          anchor={tooltip.anchor}
        />
      )}
    </>
  );
}

function ChangeRow(props: {
  readonly entry: ChangeEntry;
  readonly focused: boolean;
  onOpen(entry: ChangeEntry): void;
  onFocus(path: string): void;
}) {
  const { entry } = props;
  const counts = countsFor(entry);
  const pressable = entry.status !== "deleted";
  const directory = dirName(entry.path);
  return (
    <div
      class={`changes-row${pressable ? "" : " is-deleted"}`}
      role="option"
      aria-selected={false}
      aria-disabled={!pressable}
      data-path={entry.path}
      tabIndex={props.focused ? 0 : -1}
      title={entryTitle(entry)}
      onFocus={() => props.onFocus(entry.path)}
      onClick={() => {
        if (pressable) {
          props.onOpen(entry);
        }
      }}
    >
      <span class="changes-row__mark" aria-hidden="true">
        {STATUS_MARK[entry.status]}
      </span>
      <span class="changes-row__name">{baseName(entry.path)}</span>
      {directory.length > 0 && <span class="changes-row__dir">{directory}</span>}
      {counts.kind === "counts" && (
        <span class="changes-row__counts">
          <DiffCounts added={counts.added} removed={counts.removed} />
        </span>
      )}
      {counts.kind === "binary" && <span class="changes-row__counts">binary</span>}
    </div>
  );
}

export function ChangesList(props: ChangesListProps) {
  const { state } = props;
  const snapshot = state.snapshot;
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const entries = snapshot?.entries ?? [];
  const focusedIndex = Math.max(
    0,
    entries.findIndex((entry) => entry.path === focusedPath),
  );

  function move(to: number): void {
    const next = entries[Math.max(0, Math.min(entries.length - 1, to))];
    if (next === undefined) {
      return;
    }
    setFocusedPath(next.path);
    listRef.current
      ?.querySelectorAll<HTMLElement>(".changes-row")
      [Math.max(0, Math.min(entries.length - 1, to))]?.focus();
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      move(focusedIndex + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      move(focusedIndex - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      move(0);
    } else if (event.key === "End") {
      event.preventDefault();
      move(entries.length - 1);
    } else if (event.key === "Enter" || event.key === " ") {
      // The row the key was pressed on, which is the focused one in the app.
      const path = (event.target as HTMLElement).closest<HTMLElement>(".changes-row")?.dataset.path;
      const entry = entries.find((candidate) => candidate.path === path);
      if (entry !== undefined && entry.status !== "deleted") {
        event.preventDefault();
        props.onOpen(entry);
      }
    }
  }

  return (
    <div class="changes-list">
      <div class="changes-head" title={snapshot === null ? undefined : comparisonLabel(snapshot)}>
        <span class="file-tree__icon">
          <DeckIcon icon={GitBranch} size={ROW_ICON} />
        </span>
        <span class="changes-head__branch">
          {snapshot === null ? "Changes" : branchLabel(snapshot)}
        </span>
        {snapshot?.initial === true && <span class="changes-head__note">No commits yet</span>}
        <span class="changes-head__right">
          {snapshot !== null && snapshot.entries.length > 0 && (
            <span class="changes-head__totals">
              <DiffCounts added={snapshot.totals.added} removed={snapshot.totals.removed} />
            </span>
          )}
          <span class="file-tree__actions">
            <RefreshButton onPress={props.onRefresh} />
          </span>
        </span>
      </div>
      {snapshot === null && state.reading && <p class="changes-list__note">Reading changes…</p>}
      {snapshot !== null && entries.length === 0 && (
        <p class="changes-list__note">
          {snapshot.initial ? "No files yet." : "No changes against HEAD."}
        </p>
      )}
      {entries.length > 0 && (
        <div
          class="changes-list__rows"
          role="listbox"
          aria-label="Changed files"
          ref={listRef}
          onKeyDown={handleKeyDown}
        >
          {entries.map((entry, index) => (
            <ChangeRow
              key={entry.path}
              entry={entry}
              focused={index === focusedIndex}
              onOpen={props.onOpen}
              onFocus={setFocusedPath}
            />
          ))}
        </div>
      )}
      {snapshot !== null && snapshot.omitted > 0 && (
        <p class="changes-list__note">{omittedLabel(snapshot.omitted)}</p>
      )}
    </div>
  );
}
