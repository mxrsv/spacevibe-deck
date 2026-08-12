import { OpenBoard } from "../../open-board/open-board";
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
        blurb="Cold start, with no recents — the gallery never reads the real workspace store."
      />
      <Specimen
        name=".open-board"
        note="workspace · layout · agent, plus the brand mark (DL-14.6 exempts it)"
        surface="bg"
        tall
      >
        <OpenBoard
          canCancel
          onCancel={() => {}}
          onOpen={async () => false}
          onNewPreset={() => {}}
        />
      </Specimen>
    </>
  );
}
