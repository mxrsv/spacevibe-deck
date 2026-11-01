import { Button } from "../controls/button";
import { openFeedback, openReleaseNotes, useAboutUpdate } from "../settings/sections/about-section";
import { RowShell } from "./command-settings-live-row";

/**
 * The About rows: the update action (the one state machine the section drives, with the same
 * words) and the two links. The version and the answer to the last check read after the label.
 */
export function AboutRows() {
  const update = useAboutUpdate();
  return (
    <>
      <RowShell
        itemKey="about:update"
        active={false}
        changed={false}
        label="Check for updates"
        crumb={update.desc === "" ? null : update.desc}
        reset={null}
        control={
          <Button variant="outline" size="sm" disabled={update.disabled} onClick={update.press}>
            {update.label}
          </Button>
        }
      />
      <RowShell
        itemKey="about:notes"
        active={false}
        changed={false}
        label="Release notes"
        crumb={null}
        reset={null}
        control={
          <Button variant="outline" size="sm" onClick={() => void openReleaseNotes()}>
            Open
          </Button>
        }
      />
      <RowShell
        itemKey="about:feedback"
        active={false}
        changed={false}
        label="Feedback"
        crumb={null}
        reset={null}
        control={
          <Button variant="outline" size="sm" onClick={() => void openFeedback()}>
            Open
          </Button>
        }
      />
    </>
  );
}
