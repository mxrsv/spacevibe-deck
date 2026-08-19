import { OpenBoard } from "../../open-board/open-board";
import { DesktopChrome } from "../../ui/desktop-chrome";
import {
  agentRailNavigationSpecimen,
  NOOP,
  sidebarFrameActionsSpecimen,
} from "../chrome-fixtures";
import { SEED_WORKSPACE_HISTORY } from "../seed-data";
import { SectionHead, Specimen } from "../specimen";

function board(canCancel: boolean, openWorkspacePaths: ReadonlySet<string>) {
  return (
    <OpenBoard
      canCancel={canCancel}
      canBrowseSessions
      openWorkspacePaths={openWorkspacePaths}
      onCancel={NOOP}
      onOpen={async () => false}
      onResumeSession={async () => false}
    />
  );
}

/** The start surface in both shell states the app actually presents. */

export function BoardSection() {
  return (
    <>
      <SectionHead
        title="Open board"
        blurb="A focused start surface: full stage before work begins, live Agent Rail retained when opened mid-session."
      />
      <Specimen
        name=".open-board · cold start"
        note="no live work · no rail · no dock · start surface owns the stage"
        surface="none"
        tall
      >
        <div class="gx-chatgpt-direction gx-open-board-direction">
          <DesktopChrome
            sidebar
            toolbar={null}
            sidebarNavigation={null}
            topTabs={null}
            stage={
              <div class="stage">
                {board(false, new Set())}
              </div>
            }
            status={null}
            onMacTitlebarDoubleClick={NOOP}
          />
        </div>
      </Specimen>
      <Specimen
        name=".open-board · active work"
        note="live Agent Rail remains · dock waits · board replaces the stage"
        surface="none"
        tall
      >
        <div class="gx-chatgpt-direction gx-open-board-direction">
          <DesktopChrome
            sidebar
            sidebarToggle={sidebarFrameActionsSpecimen()}
            toolbar={null}
            sidebarNavigation={agentRailNavigationSpecimen()}
            topTabs={null}
            stage={
              <div class="stage">
                {board(true, new Set([SEED_WORKSPACE_HISTORY[0]]))}
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
