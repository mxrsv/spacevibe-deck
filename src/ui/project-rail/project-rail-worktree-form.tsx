import { useEffect, useState } from "preact/hooks";
import type { RefObject } from "preact";
import { Button } from "../controls/button";
import { Input } from "../controls/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../controls/select";
import { workspaceLabel } from "../../lib/workspace-label";
import { worktreeErrorCopy } from "../../open-board/open-board-worktree-form";
import { useWorktreeForm } from "../../open-board/use-worktree-form";
import { rememberOnRail } from "../rail-add-folder";
import type { RailRepository } from "../rail-worktree-form";

/** The picker's last row: it opens a folder dialog and leaves the choice alone. */
const BROWSE = "__browse__";

export interface ProjectRailWorktreeFormProps {
  readonly repositories: readonly RailRepository[];
  /** Preselected: the focused checkout's repository, else the first one. */
  readonly initialRepo: string | null;
  /** The popover's initial focus: the branch field, once the popover is placed. */
  readonly branchRef: RefObject<HTMLInputElement>;
  onClose(): void;
}

/**
 * The create row's `Worktree` form on the preset controls (LAY-3): the same `useWorktreeForm`
 * flow the shipped popover runs, so creation, its errors and the "remember on the rail" step
 * are one code path. It adds a branch in its own folder and starts nothing.
 */
export function ProjectRailWorktreeForm({
  repositories,
  initialRepo,
  branchRef,
  onClose,
}: ProjectRailWorktreeFormProps) {
  const form = useWorktreeForm();
  const [created, setCreated] = useState<string | null>(null);
  // Fresh state on every open, preselected once.
  useEffect(() => {
    form.reset();
    if (initialRepo !== null) {
      form.setRepo(initialRepo);
    }
    branchRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only: one reset and preselection per open
  }, []);

  const { state } = form;
  const known = repositories.some((repository) => repository.path === state.repoPath);
  const canSubmit =
    state.repoPath !== "" &&
    state.branch.trim() !== "" &&
    state.destPath.trim() !== "" &&
    !state.creating;
  const submit = (): void => {
    if (!canSubmit) {
      return;
    }
    const branch = state.branch.trim();
    void form.submit((path) => {
      rememberOnRail(path);
      setCreated(branch);
    });
  };

  if (created !== null) {
    return (
      <div className="flex flex-col gap-2">
        <p role="status">Created {created}. Nothing was started.</p>
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      </div>
    );
  }
  const selected = repositories.find((repository) => repository.path === state.repoPath);
  return (
    <form
      aria-label="New worktree"
      className="flex flex-col gap-2"
      onSubmit={(event: Event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Select
        value={state.repoPath === "" ? null : state.repoPath}
        onValueChange={(value: string | null) => {
          if (value === BROWSE) {
            void form.browseRepo();
          } else if (value !== null) {
            form.setRepo(value);
          }
        }}
      >
        <SelectTrigger className="w-full" aria-label="Repository">
          <SelectValue placeholder="Select a repository">
            {selected?.label ??
              (state.repoPath === "" ? undefined : workspaceLabel(state.repoPath))}
          </SelectValue>
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          {state.repoPath !== "" && !known ? (
            <SelectItem value={state.repoPath}>{workspaceLabel(state.repoPath)}</SelectItem>
          ) : null}
          {repositories.map((repository) => (
            <SelectItem key={repository.path} value={repository.path}>
              {repository.label}
            </SelectItem>
          ))}
          <SelectItem value={BROWSE}>Browse…</SelectItem>
        </SelectContent>
      </Select>
      <Input
        ref={branchRef}
        aria-label="Branch"
        placeholder="feature/my-branch"
        value={state.branch}
        onInput={(event: Event) => form.setBranch((event.target as HTMLInputElement).value)}
      />
      {state.destPath === "" ? null : (
        <Input
          aria-label="Location"
          value={state.destPath}
          onInput={(event: Event) => form.setDest((event.target as HTMLInputElement).value)}
        />
      )}
      {state.error === null ? null : (
        <p role="alert" className="text-destructive">
          {worktreeErrorCopy(state.error)}
        </p>
      )}
      <div className="flex justify-end gap-1.5">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={!canSubmit}>
          {state.creating ? "Creating…" : "Create"}
        </Button>
      </div>
    </form>
  );
}
