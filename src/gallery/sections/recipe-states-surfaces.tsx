import { File01Icon } from "@hugeicons/core-free-icons";
import { PaneAgentHeader } from "../../terminal/pane-agent-header";
import type { PaneView } from "../../terminal/tabs-store";
import { DockFileTab } from "../../ui/agent-dock/dock-file-tab";
import { StripCell } from "../../ui/agent-dock/dock-strip-cell";
import { RowShell } from "../../ui/command-settings/command-settings-live-row";
import { DeckIcon } from "../../ui/controls/deck-icon";
import { Badge, Button, Input, Kbd, Switch } from "../../ui/controls/preset-controls";
import { DockToggle } from "../../ui/dock/dock-toggle";
import { pane } from "../../ui/rail-view-fixtures";
import { UpdateAction } from "../../updater/update-action";
import type { UpdateView } from "../../updater/update-controller";
import { SectionHead, Specimen } from "../specimen";
import { isSelected, StateSheet, useForcedStates, type SheetRow } from "./recipe-states-kit";

/** The stage, dock, overlay and Command Settings sheets (RCP-3, RCP-9, RCP-20 to RCP-22). */

const NOOP = (): void => {};
const INPUT = { send: async () => true, focus: NOOP };

const view = (phase: UpdateView["phase"]): UpdateView => ({
  phase,
  currentVersion: "0.40.0",
  availableVersion: "0.41.0",
  notes: "",
});

/** The flush pane header in its real markup; selected is the focused pane of a split. */
function paneHead(selected: boolean, over: Partial<PaneView>) {
  return (
    <div class="stage--flush has-multiple-panes">
      <div class={`pane-slot${selected ? " is-active" : ""}`}>
        <div class="pane pane--agent-header">
          <div class="pane__bar">
            <div class="pane-agent-header-host">
              <PaneAgentHeader
                pane={pane(7, { phase: "working", ...over })}
                message="Wiring the ratchet"
                input={INPUT}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const STAGE: readonly SheetRow[] = [
  {
    label: "pane header",
    draw: (state) =>
      ["rest", "selected", "needs you"].includes(state)
        ? paneHead(isSelected(state), state === "needs you" ? { attention: "requested" } : {})
        : null,
  },
  {
    label: "toolbar icon",
    draw: (state) =>
      isSelected(state) || state === "drag-over" || state === "needs you" ? null : (
        <DockToggle open={false} onToggle={NOOP} />
      ),
  },
  {
    label: "update",
    draw: (state) =>
      ["rest", "hover", "focus", "pressed"].includes(state) ? (
        <UpdateAction
          view={view("available")}
          onCheck={NOOP}
          onDownload={NOOP}
          onInstall={NOOP}
          onRelaunch={NOOP}
        />
      ) : state === "disabled" ? (
        <UpdateAction
          view={view("downloading")}
          onCheck={NOOP}
          onDownload={NOOP}
          onInstall={NOOP}
          onRelaunch={NOOP}
        />
      ) : null,
  },
];

const DOCK: readonly SheetRow[] = [
  {
    label: "view cell",
    draw: (state) =>
      state === "drag-over" || state === "needs you" ? null : (
        <StripCell aria-pressed={isSelected(state)} disabled={state === "disabled"} mark="fill">
          <DeckIcon icon={File01Icon} />
        </StripCell>
      ),
  },
  {
    label: "file tab",
    draw: (state) =>
      state === "disabled" || state === "needs you" ? null : (
        <DockFileTab
          path="/w/deck/src/styles/01-tokens.css"
          preview={false}
          dirty={state === "drag-over"}
          active={isSelected(state)}
          paths={["/w/deck/src/styles/01-tokens.css"]}
          onSelect={NOOP}
          onKeep={NOOP}
          onClose={NOOP}
        />
      ),
  },
];

const OVERLAYS: readonly SheetRow[] = (["default", "outline", "ghost", "destructive"] as const).map(
  (variant) => ({
    label: variant === "default" ? "primary" : variant,
    draw: (state) =>
      isSelected(state) || state === "drag-over" || state === "needs you" ? null : (
        <Button variant={variant} size="sm" disabled={state === "disabled"}>
          Run
        </Button>
      ),
  }),
);

const FIELDS: readonly SheetRow[] = [
  {
    label: "input",
    draw: (state) =>
      ["rest", "hover", "focus", "disabled"].includes(state) ? (
        <Input placeholder="Search" disabled={state === "disabled"} />
      ) : null,
  },
  {
    label: "kbd · badge",
    draw: (state) =>
      state === "rest" ? (
        <span class="flex items-center gap-2">
          <Kbd>⌘O</Kbd>
          <Badge variant="secondary">12</Badge>
        </span>
      ) : null,
  },
];

const SETTINGS: readonly SheetRow[] = [
  {
    label: "setting row",
    draw: (state) =>
      ["rest", "selected", "disabled"].includes(state) ? (
        <ul class="m-0 list-none p-0">
          <RowShell
            itemKey={`gallery-${state}`}
            active={state === "selected"}
            changed={state === "selected"}
            label="Show hidden files"
            crumb="Files"
            control={<Switch disabled={state === "disabled"} />}
            reset={null}
          />
        </ul>
      ) : null,
  },
];

function Surface({
  title,
  blurb,
  rows,
  ground,
}: {
  title: string;
  blurb: string;
  rows: readonly SheetRow[];
  ground?: string;
}) {
  return (
    <Specimen name={title} note={blurb}>
      <StateSheet rows={rows} ground={ground} columnWidth="minmax(12rem, 1fr)" />
    </Specimen>
  );
}

export function RecipeStageSection() {
  useForcedStates();
  return (
    <>
      <SectionHead
        title="stage · states"
        blurb="The pane header, toolbar and update action, beside the mock's stage tab (stage.html)."
      />
      <Surface title="stage bar and pane header" blurb="RCP-20" rows={STAGE} />
    </>
  );
}

export function RecipeDockSection() {
  useForcedStates();
  return (
    <>
      <SectionHead
        title="dock · states"
        blurb="The dock strip's cells and file tabs, beside the mock's dock tab (dock.html)."
      />
      <Surface title="dock strip" blurb="RCP-9, RCP-20" rows={DOCK} ground="--sidebar-bg" />
    </>
  );
}

export function RecipeOverlaysSection() {
  useForcedStates();
  return (
    <>
      <SectionHead
        title="overlays · states"
        blurb="The preset controls on the recipes, beside the mock's overlays tab (overlays.html)."
      />
      <Surface
        title="buttons"
        blurb="RCP-3: 600 text, the pressed layer, primary's own steps"
        rows={OVERLAYS}
        ground="--popover-bg"
      />
      <Surface
        title="fields and keys"
        blurb="RCP-9: only a text input wears the ring; RCP-13"
        rows={FIELDS}
        ground="--popover-bg"
      />
    </>
  );
}

export function RecipeSettingsSection() {
  useForcedStates();
  return (
    <>
      <SectionHead
        title="settings · states"
        blurb="Command Settings' row, beside the mock's settings tab (settings.html)."
      />
      <Surface
        title="setting row"
        blurb="RCP-7: at least 44"
        rows={SETTINGS}
        ground="--popover-bg"
      />
    </>
  );
}
