import { OpenBoard } from "../../open-board/open-board";
import { DesktopChrome } from "../../ui/desktop-chrome";
import { SidebarToggle } from "../../ui/sidebar-toggle";
import { agentRailNavigationSpecimen, NOOP } from "../chrome-fixtures";
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
        note="shared project/tab AgentRail · workspace · one click opens"
        surface="none"
        tall
      >
        <div class="gx-chatgpt-direction gx-open-board-direction">
          <DesktopChrome
            sidebar
            sidebarToggle={<SidebarToggle collapsed={false} onToggle={NOOP} />}
            toolbar={null}
            sidebarNavigation={agentRailNavigationSpecimen()}
            topTabs={null}
            stage={
              <div class="stage">
                <OpenBoard
                  canCancel
                  onCancel={NOOP}
                  onOpen={async () => false}
                  // The board's "Recent sessions" block reads a real scan in
                  // the app; the gallery has no host, so this specimen shows
                  // the board without it rather than with invented sessions.
                  recentSessions={[]}
                  onResumeSession={NOOP}
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
