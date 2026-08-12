import { OpenBoard } from "../../open-board/open-board";
import { DesktopChrome } from "../../ui/app";
import {
  chatGptToolbarSpecimen,
  NOOP,
  repositorySidebarSpecimen,
} from "../chrome-fixtures";
import { SectionHead, Specimen } from "../specimen";

/**
 * The Open board — the first surface a user sees, and the one with the most
 * bespoke geometry in the app (three sections, chip rows, workspace list,
 * layout thumbnails).
 *
 * Recents are empty on purpose: the gallery must not read the user's real
 * workspace store, so this is the board's cold-start state. That state is
 * worth judging anyway — it is what a new install looks like.
 */

export function BoardSection() {
  return (
    <>
      <SectionHead
        title="Open board"
        blurb="The cold-start flow becomes a calm sidebar-and-workspace composition while preserving Deck's real actions."
      />
      <Specimen
        name=".open-board"
        note="shared repository/worktree navigation · workspace · layout · agent"
        surface="none"
        tall
      >
        <div class="gx-chatgpt-direction gx-open-board-direction">
          <DesktopChrome
            sidebar
            toolbar={chatGptToolbarSpecimen()}
            sidebarNavigation={repositorySidebarSpecimen()}
            topTabs={null}
            stage={
              <div class="stage">
                <OpenBoard
                  canCancel
                  onCancel={NOOP}
                  onOpen={async () => false}
                  onNewPreset={NOOP}
                />
              </div>
            }
            status={null}
            onMacTitlebarDoubleClick={NOOP}
          />
        </div>
      </Specimen>
    </>
  );
}
