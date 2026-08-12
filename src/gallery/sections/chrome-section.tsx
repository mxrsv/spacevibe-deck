import { Fragment } from "preact";
import { AgentAttentionMark } from "../../ui/agent-attention-mark";
import { WorkspaceSpinner } from "../../ui/workspace-spinner";
import { PresetThumb } from "../../presets/preset-thumb";
import { UpdateAction } from "../../updater/update-action";
import type { UpdatePhase } from "../../updater/update-controller";
import { SEED_ATTENTION, SEED_LAYOUT } from "../seed-data";
import { SectionHead, Specimen, StateLabel } from "../specimen";
import {
  WORKBENCH_VARIANTS,
  WorkbenchSpecimen,
  type WorkbenchVariant,
} from "./workbench-specimen";

/**
 * Round one of the agent workbench comparison, over the component states the
 * chrome is made of.
 *
 * The two `DesktopChrome` specimens that used to open this section — top tabs
 * versus left sidebar — were a comparison of the shell Deck already ships, and
 * that question is settled. What replaces them is the open one: which of three
 * compositions the workbench should take
 * (docs/specs/2026-08-12-agent-workbench-gallery-design.md). The state
 * specimens below are untouched, because they cover components rather than
 * composition and would lose their coverage if they moved with the shell.
 */

const NOOP = (): void => {};

/** Both review widths, in the order the owner compares them. */
const WORKBENCH_ORDER: readonly WorkbenchVariant[] = [
  "balanced",
  "rail",
  "stage",
];

const WORKBENCH_NOTE: Readonly<Record<WorkbenchVariant, string>> = {
  balanced:
    "stable workspace rail · dominant stage · medium dock — navigation and file reading cost the same",
  rail: "widest left region, project → workspace → agent · all three panes side by side for supervision",
  stage:
    "narrowest navigation, widest stage · the dock stays bounded and one action away",
};

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

export function ChromeSection() {
  return (
    <>
      <SectionHead
        title="Window chrome"
        blurb="Three workbench compositions on identical fixture data, each at a wide and a compact desktop width. The sidebar toggle is live — click it and the rail leaves entirely, taking the window buttons with it into the stage. Structure only: treatment is round two, so nothing below is arguing about colour yet."
      />

      {WORKBENCH_ORDER.map((variant) => (
        <Fragment key={variant}>
          <Specimen
            name={`${WORKBENCH_VARIANTS[variant].label} — wide`}
            note={WORKBENCH_NOTE[variant]}
            surface="none"
            tall
          >
            <WorkbenchSpecimen variant={variant} />
          </Specimen>

          <Specimen
            name={`${WORKBENCH_VARIANTS[variant].label} — compact`}
            note="900px of window: metadata collapses, both side regions narrow, the stage keeps the room"
            surface="none"
          >
            <WorkbenchSpecimen variant={variant} compact />
          </Specimen>
        </Fragment>
      ))}

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
