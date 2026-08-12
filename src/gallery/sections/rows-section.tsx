import {
  ConfigGroup,
  ConfigRow,
  ToggleRow,
} from "../../ui/controls/config-row";
import { CommitInput } from "../../ui/controls/commit-input";
import { CommitTextarea } from "../../ui/controls/commit-textarea";
import { SETTINGS_CATEGORIES } from "../../ui/settings/settings-categories";
import { SectionHead, Specimen } from "../specimen";

/**
 * DL §5's one control, in every shape the app can put it in.
 *
 * The seven value kinds are not re-typed here: each real settings section is
 * mounted as its own specimen, so `cycle`, `menu`, `step`, `color`, `picker`,
 * `toggle` and `action` are the ones that ship. Re-typing their markup would
 * make this page a second source of truth and it would drift the first time a
 * pill changed.
 *
 * Only states the sections cannot produce on their own are hand-assembled
 * below, and those still come from the real components' props (`danger`,
 * `disabled`) rather than from copied class strings.
 */

export function RowsSection() {
  return (
    <>
      <SectionHead
        title="Config rows"
        blurb="Every real settings value kind under the shared soft-row, recessed-control and neutral-selection treatment."
      />

      {SETTINGS_CATEGORIES.map((category) => {
        const Section = category.Section;
        return (
          <Specimen
            key={category.id}
            name={`${category.label} — real section`}
            note="mounted straight from SETTINGS_CATEGORIES"
            surface="chrome-2"
          >
            <div class="settings-screen__section">
              <Section />
            </div>
          </Specimen>
        );
      })}

      <Specimen
        name="row anatomy"
        note="key · optional description · one interactive value (DL-5)"
        surface="chrome-2"
      >
        <div class="settings-screen__section">
          <ConfigGroup label="group label" />
          <ToggleRow label="Key only" checked onToggle={() => {}} />
          <ToggleRow
            label="Key with description"
            desc="one lowercase line, faint"
            checked={false}
            onToggle={() => {}}
          />
          <ToggleRow
            label="Disabled value"
            desc="the native button is disabled, not merely dimmed"
            checked={false}
            onToggle={() => {}}
            disabled
          />
          <ConfigRow
            label="Danger key"
            desc="red key, for destructive rows (DL-3.2)"
            danger
          >
            <button type="button" class="cfg-btn cfg-btn--danger">
              delete
            </button>
          </ConfigRow>
        </div>
      </Specimen>

      <Specimen
        name="CommitInput · CommitTextarea"
        note="DL-6.3 / DL-13.5 — drafts live locally and commit on blur, Enter, or Cmd+Enter; Esc reverts"
        surface="chrome-2"
      >
        <div class="settings-screen__section">
          <ConfigRow label="Single line" desc="commits on blur or Enter">
            <CommitInput
              value="~/Documents/Development"
              placeholder="a path"
              ariaLabel="Single line specimen"
              onCommit={() => {}}
            />
          </ConfigRow>
          <div class="cfg-custom">
            <CommitTextarea
              value={"Review the diff on this branch.\nName the risky change."}
              placeholder="a prompt body"
              ariaLabel="Multi line specimen"
              onCommit={() => {}}
            />
          </div>
        </div>
      </Specimen>
    </>
  );
}
