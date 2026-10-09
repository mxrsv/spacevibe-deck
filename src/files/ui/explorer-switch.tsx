/**
 * The Explorer's first row (variant A, spec decision 8): a Files / Changes
 * switch. A `role="tablist"` of two chips, DL-21.1's wash on the active one and
 * none on the idle one, walked with ←/→ like DL-19.8's chip row.
 *
 * The view that is showing names itself on the row below it — the root row for
 * Files, the branch row for Changes — and that row carries the view's actions
 * (DL-19.9), so nothing here belongs to one view.
 */
import type { ExplorerView } from "../changes/explorer-view";

export interface ExplorerSwitchProps {
  readonly view: ExplorerView;
  /** `+N −M` beside the Changes chip; null before the first reply. */
  readonly changesTotals: string | null;
  /** Why Changes cannot be opened, or null when it can (CHG4). */
  readonly changesDisabledReason: string | null;
  onSelect(view: ExplorerView): void;
}

export function ExplorerSwitch(props: ExplorerSwitchProps) {
  const { view, changesTotals, changesDisabledReason } = props;
  const disabled = changesDisabledReason !== null;

  function handleKeyDown(event: KeyboardEvent): void {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }
    event.preventDefault();
    const next: ExplorerView = event.key === "ArrowRight" ? "changes" : "files";
    if (next === "changes" && disabled) {
      return;
    }
    props.onSelect(next);
    const list = event.currentTarget as HTMLElement;
    list.querySelector<HTMLElement>(`[data-view="${next}"]`)?.focus();
  }

  return (
    <div
      class="explorer-switch"
      role="tablist"
      aria-label="Explorer view"
      onKeyDown={handleKeyDown}
    >
      <button
        type="button"
        role="tab"
        data-view="files"
        class={`explorer-switch__chip${view === "files" ? " is-active" : ""}`}
        aria-selected={view === "files"}
        tabIndex={view === "files" ? 0 : -1}
        onClick={() => props.onSelect("files")}
      >
        Files
      </button>
      <button
        type="button"
        role="tab"
        data-view="changes"
        class={`explorer-switch__chip${view === "changes" ? " is-active" : ""}`}
        aria-selected={view === "changes"}
        aria-disabled={disabled}
        tabIndex={view === "changes" ? 0 : -1}
        title={changesDisabledReason ?? undefined}
        onClick={() => {
          if (!disabled) {
            props.onSelect("changes");
          }
        }}
      >
        Changes
        {changesTotals !== null && <span class="explorer-switch__totals">{changesTotals}</span>}
      </button>
    </div>
  );
}
