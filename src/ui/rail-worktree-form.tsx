import { useEffect, useRef, useState } from "preact/hooks";
import { useWorktreeForm } from "../open-board/use-worktree-form";
import { worktreeErrorCopy } from "../open-board/open-board-worktree-form";
import { workspaceLabel } from "../lib/workspace-label";
import { rememberOnRail } from "./rail-add-folder";
import {
  useDismiss,
  useStageOverlayFlag,
  useSurfacePlacement,
  type AnchorRect,
} from "./worktree-card-menus";

/** A repository the form can branch from — one the rail already shows. */
export interface RailRepository {
  readonly path: string;
  readonly label: string;
}

export interface RailWorktreeFormProps {
  /** The `Worktree` button: the form hangs under it, or beside the collapsed column. */
  readonly anchor: HTMLElement;
  readonly side: "below" | "right";
  readonly repositories: readonly RailRepository[];
  /** Preselected: the focused checkout's repository, else the first one. */
  readonly initialRepo: string | null;
  onClose(): void;
}

const BROWSE = "__browse__";

/**
 * The create row's `Worktree` form (DL-27.14, amended 2026-10-08): a DL-13 popover that
 * adds a branch in its own folder and starts nothing. On success the new checkout is
 * remembered so the rail prints it; the form then says so and waits to be closed.
 */
export function RailWorktreeForm({
  anchor,
  side,
  repositories,
  initialRepo,
  onClose,
}: RailWorktreeFormProps) {
  const form = useWorktreeForm();
  const [created, setCreated] = useState<string | null>(null);
  const [rect] = useState<AnchorRect>(() => anchor.getBoundingClientRect());
  const { ref, style, placed } = useSurfacePlacement(rect, side);
  const branchRef = useRef<HTMLInputElement>(null);
  useDismiss(onClose, ref, anchor);
  useStageOverlayFlag();

  // Fresh state on every open, preselected once; focus the branch field once placed
  // (a hidden surface cannot take focus).
  useEffect(() => {
    form.reset();
    if (initialRepo !== null) {
      form.setRepo(initialRepo);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // DL-13.2: on dismiss, focus returns to the control that had it — the `Worktree`
  // button. Guarded on still being connected, as the card menu's own return is.
  useEffect(
    () => () => {
      if (anchor.isConnected) {
        anchor.focus();
      }
    },
    [anchor],
  );
  useEffect(() => {
    if (placed) {
      branchRef.current?.focus();
    }
  }, [placed]);

  const { state } = form;
  const known = repositories.some((repository) => repository.path === state.repoPath);
  const canSubmit =
    state.repoPath !== "" &&
    state.branch.trim() !== "" &&
    state.destPath.trim() !== "" &&
    !state.creating;

  function submit(): void {
    if (!canSubmit) {
      return;
    }
    void form.submit((path) => {
      rememberOnRail(path);
      setCreated(path);
    });
  }

  return (
    <div
      ref={ref}
      class="asr-pop rail-wt"
      role="dialog"
      aria-label="New worktree"
      style={style}
      onKeyDown={(event) => {
        if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
          event.preventDefault();
          submit();
        }
      }}
    >
      {created !== null ? (
        <>
          <p class="rail-wt__done" role="status">
            Created {workspaceLabel(created)}. Nothing was started.
          </p>
          <div class="rail-wt__actions">
            <button type="button" class="rail-wt__button" onClick={onClose}>
              Close
            </button>
          </div>
        </>
      ) : (
        <>
          <label class="rail-wt__label" for="rail-wt-repo">
            Repository
          </label>
          <select
            id="rail-wt-repo"
            class="rail-wt__field"
            value={state.repoPath}
            onChange={(event) => {
              const value = event.currentTarget.value;
              if (value === BROWSE) {
                void form.browseRepo();
              } else {
                form.setRepo(value);
              }
            }}
          >
            <option value="">Select a repository…</option>
            {state.repoPath !== "" && !known && (
              <option value={state.repoPath}>{workspaceLabel(state.repoPath)}</option>
            )}
            {repositories.map((repository) => (
              <option key={repository.path} value={repository.path}>
                {repository.label}
              </option>
            ))}
            <option value={BROWSE}>Browse…</option>
          </select>
          <label class="rail-wt__label" for="rail-wt-branch">
            Branch
          </label>
          <input
            id="rail-wt-branch"
            ref={branchRef}
            class="rail-wt__field"
            value={state.branch}
            placeholder="feature/my-branch"
            onInput={(event) => form.setBranch(event.currentTarget.value)}
          />
          <label class="rail-wt__label" for="rail-wt-dest">
            Location
          </label>
          <input
            id="rail-wt-dest"
            class="rail-wt__field rail-wt__field--quiet"
            value={state.destPath}
            onInput={(event) => form.setDest(event.currentTarget.value)}
          />
          {state.error !== null && (
            <p class="rail-wt__error" role="alert">
              {worktreeErrorCopy(state.error)}
            </p>
          )}
          <div class="rail-wt__actions">
            <button type="button" class="rail-wt__button" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              class="rail-wt__button rail-wt__button--primary"
              disabled={!canSubmit}
              onClick={submit}
            >
              {state.creating ? "Creating…" : "Create"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
