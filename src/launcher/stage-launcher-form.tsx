import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { useEffect } from "preact/hooks";
import { open } from "../host/dialog-host";
import { createWorkspace } from "../host/workspace-create-host";
import { getDesktopEnvironment } from "../lib/platform";
import type { SessionEntry } from "../lib/session-history";
import type { RecentWorkspace } from "../lib/workspace-recents";
import { getCloneController } from "../open-board/clone-session";
import { CloneWorkspaceForm } from "../open-board/clone-workspace-form";
import { CreateWorkspaceForm } from "../open-board/create-workspace-form";
import { OpenBoardWorktreeForm } from "../open-board/open-board-worktree-form";
import { useWorktreeForm } from "../open-board/use-worktree-form";
import { refreshSessions } from "../sessions/sessions-store";
import { Button } from "../ui/controls/button";
import { DeckIcon } from "../ui/controls/deck-icon";
import { StageCover } from "../ui/project-rail/project-rail-menu-parts";
import { rememberOnRail } from "../ui/rail-add-folder";
import { SessionsBody } from "../ui/sessions/sessions-body";
import type { StageForm } from "./stage-launcher-form-store";
import { StageLauncherSlot } from "./stage-launcher-slot";

export interface StageLauncherFormProps {
  readonly form: StageForm;
  /** The folders the worktree form offers as its repository. */
  readonly recents: readonly RecentWorkspace[];
  /** Leave the form for the launcher; `path` is the workspace the form made, to aim the bar at. */
  onLeave(path: string | null): void;
  onResumeSession(entry: SessionEntry): Promise<boolean>;
}

const pickParent = (): Promise<string | null> => open({ directory: true, multiple: false });

/** The worktree form with the state the Open board keeps for it, aimed at the bar's repository. */
function StageWorktreeForm({
  repoPath,
  recents,
  onLeave,
}: {
  readonly repoPath: string | null;
  readonly recents: readonly RecentWorkspace[];
  onLeave(path: string | null): void;
}) {
  const worktree = useWorktreeForm();
  const { homeDir } = getDesktopEnvironment();
  /* oxlint-disable react-hooks/exhaustive-deps -- mount-once: a fresh attempt each time the form opens */
  useEffect(() => {
    worktree.reset();
    if (repoPath !== null) worktree.setRepo(repoPath);
  }, []);
  /* oxlint-enable react-hooks/exhaustive-deps */
  // The repository the bar is aimed at may be a live workspace history has not listed.
  const choices =
    repoPath === null || recents.some((recent) => recent.path === repoPath)
      ? recents
      : [{ path: repoPath, lastOpenedAt: 0 }, ...recents];
  return (
    <OpenBoardWorktreeForm
      recents={choices}
      homeDir={homeDir}
      repoPath={worktree.state.repoPath}
      branch={worktree.state.branch}
      destPath={worktree.state.destPath}
      error={worktree.state.error}
      creating={worktree.state.creating}
      onRepoChange={worktree.setRepo}
      onBrowseRepo={() => void worktree.browseRepo()}
      onBranchChange={worktree.setBranch}
      onDestChange={worktree.setDest}
      onBack={() => onLeave(null)}
      onSubmit={() =>
        void worktree.submit((path) => {
          rememberOnRail(path);
          onLeave(path);
        })
      }
    />
  );
}

/** The session list the Open board's "Resume a previous session…" opened, with a way back. */
function StageSessions({
  onLeave,
  onResumeSession,
}: Pick<StageLauncherFormProps, "onResumeSession"> & { onLeave(path: string | null): void }) {
  useEffect(() => {
    void refreshSessions();
  }, []);
  return (
    <div class="stage-launcher-form__sessions">
      <header class="stage-launcher-form__head">
        <Button variant="ghost" size="icon" aria-label="Back" onClick={() => onLeave(null)}>
          <DeckIcon icon={ArrowLeft01Icon} />
        </Button>
        <h1>Resume a session</h1>
      </header>
      <SessionsBody
        variant="dock"
        onResume={(entry) =>
          void onResumeSession(entry).then((resumed) => {
            if (resumed) onLeave(null);
          })
        }
      />
    </div>
  );
}

/**
 * The stage slot holding one of the forms the Open board used to hold (LCH-8), in the launcher's
 * place. The forms keep their own progress and cancel behaviour; this only gives them a home and
 * hands the workspace they made back to the launcher through `onLeave`.
 */
export function StageLauncherForm({
  form,
  recents,
  onLeave,
  onResumeSession,
}: StageLauncherFormProps) {
  const { homeDir } = getDesktopEnvironment();
  return (
    <StageLauncherSlot>
      {/* The covered stage's native browser view must hide, and Esc must reach the form. */}
      <StageCover />
      <div
        class="stage-launcher-form"
        data-stage-form={form.kind}
        onKeyDown={(event: KeyboardEvent) => {
          if (event.key !== "Escape" || event.defaultPrevented) return;
          event.preventDefault();
          event.stopPropagation();
          onLeave(null);
        }}
      >
        {form.kind === "clone" ? (
          <main class="nt-board">
            <div class="nt-board__content nt-board__content--subview">
              <CloneWorkspaceForm
                controller={getCloneController()}
                home={homeDir}
                onPickParent={pickParent}
                onBack={() => onLeave(null)}
              />
            </div>
          </main>
        ) : form.kind === "create" ? (
          <main class="nt-board">
            <div class="nt-board__content nt-board__content--subview">
              <CreateWorkspaceForm
                initialParent={homeDir}
                onPickParent={pickParent}
                create={createWorkspace}
                onCreated={(path) => {
                  rememberOnRail(path);
                  onLeave(path);
                }}
                onBack={() => onLeave(null)}
              />
            </div>
          </main>
        ) : form.kind === "worktree" ? (
          <StageWorktreeForm repoPath={form.repoPath} recents={recents} onLeave={onLeave} />
        ) : (
          <StageSessions onLeave={onLeave} onResumeSession={onResumeSession} />
        )}
      </div>
    </StageLauncherSlot>
  );
}
