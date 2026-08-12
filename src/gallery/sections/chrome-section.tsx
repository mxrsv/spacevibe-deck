import { AgentAttentionMark } from "../../ui/agent-attention-mark";
import { DesktopChrome } from "../../ui/app";
import { StatusBar } from "../../ui/status-bar";
import { WorkspaceSpinner } from "../../ui/workspace-spinner";
import {
  NOOP,
  tabBarSpecimen,
  workspaceSidebarSpecimen,
} from "../chrome-fixtures";
import { PresetThumb } from "../../presets/preset-thumb";
import { UpdateAction } from "../../updater/update-action";
import type { UpdatePhase } from "../../updater/update-controller";
import { SEED_ATTENTION, SEED_LAYOUT } from "../seed-data";
import { SectionHead, Specimen, StateLabel } from "../specimen";

/**
 * The window shell in both layouts, assembled by the app's own
 * `DesktopChrome` — so the grid, the hairlines and the bar heights here are
 * the shipped ones, not a reconstruction.
 *
 * Tab hover, tab selection and the options popover are all live: clicking the
 * active tab opens the real `TabPopover` through `TabBar`'s own state.
 */

/** Every phase the update pill can be in, `hidden` excluded — it renders nothing. */
const UPDATE_PHASES: readonly Exclude<UpdatePhase, "hidden">[] = [
  "available",
  "downloading",
  "downloaded",
  "download-failed",
  "installing",
  "install-failed",
  "relaunch-failed",
];

function FakeStage({ label }: { label: string }) {
  return (
    <div class="stage">
      <div class="gx-fakepane">{label}</div>
    </div>
  );
}

export function ChromeSection() {
  return (
    <>
      <SectionHead
        title="Window chrome"
        blurb="Both tab-bar positions, rendered through the app's own DesktopChrome shell."
      />

      <Specimen
        name="window — tabBarPosition: top"
        note="titlebar · tab bar · stage · status, on the real grid"
        surface="none"
        tall
      >
        <DesktopChrome
          sidebar={false}
          toolbar={null}
          sidebarNavigation={null}
          topTabs={tabBarSpecimen()}
          stage={<FakeStage label="terminal panes live here" />}
          status={<StatusBar />}
          onMacTitlebarDoubleClick={NOOP}
        />
      </Specimen>

      <Specimen
        name="window — tabBarPosition: left"
        note="the same shell in sidebar mode; the toolbar moves into the titlebar"
        surface="none"
        tall
      >
        <DesktopChrome
          sidebar
          toolbar={null}
          sidebarNavigation={workspaceSidebarSpecimen()}
          topTabs={null}
          stage={<FakeStage label="terminal panes live here" />}
          status={<StatusBar />}
          onMacTitlebarDoubleClick={NOOP}
        />
      </Specimen>

      <Specimen
        name="AgentAttentionMark"
        note="every kind the rail can summarise; idle renders nothing at all"
        surface="chrome-1"
      >
        <div class="gx-inline">
          {SEED_ATTENTION.map((summary) => (
            <span key={summary.kind} class="gx-inline__item">
              <StateLabel>{summary.kind}</StateLabel>
              <span class="tab__attn">
                <AgentAttentionMark
                  summary={summary}
                  label={`${summary.kind} tab`}
                  onActivate={NOOP}
                />
              </span>
            </span>
          ))}
        </div>
      </Specimen>

      <Specimen
        name="UpdateAction"
        note="all seven visible phases — the app only ever shows one"
        surface="chrome-1"
      >
        <div class="gx-inline">
          {UPDATE_PHASES.map((phase) => (
            <span key={phase} class="gx-inline__item">
              <StateLabel>{phase}</StateLabel>
              <UpdateAction
                view={{
                  phase,
                  currentVersion: "0.12.2",
                  availableVersion: "0.12.3",
                  notes: "Fixes the thing.",
                }}
                onDownload={NOOP}
                onInstall={NOOP}
                onRelaunch={NOOP}
              />
            </span>
          ))}
        </div>
      </Specimen>

      <Specimen
        name="WorkspaceSpinner · PresetThumb"
        note="DL-14.6 exempts both from the icon system — one is a status visual, one is a diagram"
        surface="chrome-1"
      >
        <div class="gx-inline">
          <span class="gx-inline__item">
            <StateLabel>agent pending</StateLabel>
            <WorkspaceSpinner />
          </span>
          <span class="gx-inline__item">
            <StateLabel>layout thumbnail</StateLabel>
            <PresetThumb layout={SEED_LAYOUT} />
          </span>
        </div>
      </Specimen>
    </>
  );
}
