import {
  ArrowClockwise,
  ArrowsInLineVertical,
  CaretDown,
  CaretRight,
  ClockCounterClockwise,
  FileCode,
  FilePlus,
  FileText,
  Folder,
  FolderPlus,
  SidebarSimple,
  TreeStructure,
  ChartBar,
} from "@phosphor-icons/react";
import {
  CHROME_ICON,
  DeckIcon,
  FEATURE_ICON,
  ROW_ICON,
  type DeckIconComponent,
  type DeckIconSize,
} from "../../ui/controls/deck-icon";
import { SectionHead, Specimen, SpecimenRow, StateLabel } from "../specimen";
import "./explorer-header-variants.css";

/**
 * Explorer header direction review (2026-08-25). A DRAWING, not the app.
 *
 * The question: the explorer needs New File / New Folder / Refresh /
 * Collapse All, and a visible root row. Where do the four controls live?
 *
 * VS Code answers it with a section title bar that owns both the word
 * EXPLORER and the actions. Deck has no such bar to copy — DL-19.3's header
 * IS the tab row (DL-19.7), shared by three surfaces, `--frame-h` tall, with
 * the hide control pinned at the column's outer edge. So the four controls
 * have to be placed against that constraint rather than dropped into it.
 *
 * Every column below is hand-authored markup using the app's own classes and
 * tokens, NOT `FileTreeView` — the root row does not exist yet, and a layout
 * question is answerable from a drawing. Nothing here is imported by the app;
 * the `gxe-` classes are gallery-only and live in the sibling stylesheet.
 *
 * DL cost, stated per candidate because it is what is being chosen:
 * - A  a second row under the shared header. Needs a NEW rule in DL §19: a
 *      panel's tab may own an action row of its own. Costs 26px of tree.
 * - B  the four controls join the shared header. Amends DL-19.3/DL-19.7 —
 *      the header stops being only the tab row — and makes the dock host
 *      carry per-tab controls it currently knows nothing about.
 * - C  the controls ride the root row, revealed on hover/focus. No new row;
 *      the rail's project header already does exactly this (DL-27.18), so
 *      this is an existing Deck genre rather than an imported one. Costs
 *      discoverability: at rest the column shows no actions at all.
 */

const ROOT_NAME = "spacevibe-deck";

interface Entry {
  readonly name: string;
  readonly icon: DeckIconComponent;
  readonly directory: boolean;
}

const CHILDREN: readonly Entry[] = [
  { name: "electron", icon: Folder, directory: true },
  { name: "src", icon: Folder, directory: true },
  { name: "AGENTS.md", icon: FileText, directory: false },
  { name: "package.json", icon: FileCode, directory: false },
];

interface ActionSpec {
  readonly label: string;
  readonly icon: DeckIconComponent;
}

/** The four the owner picked. Order is VS Code's: create, create, refresh, collapse. */
const ACTIONS: readonly ActionSpec[] = [
  { label: "New file", icon: FilePlus },
  { label: "New folder", icon: FolderPlus },
  { label: "Refresh", icon: ArrowClockwise },
  { label: "Collapse all", icon: ArrowsInLineVertical },
];

function ActionButtons({ size }: { size: DeckIconSize }) {
  return (
    <>
      {ACTIONS.map((action) => (
        <button
          key={action.label}
          type="button"
          class="iconbtn gxe-action"
          aria-label={action.label}
        >
          <DeckIcon icon={action.icon} size={size} />
        </button>
      ))}
    </>
  );
}

/**
 * The same four in the shape a 22px DATA row can hold.
 *
 * NOT `.iconbtn`: that box is 24x24, and four of them inside `.file-tree__row`
 * overflow it by 1px above and 1px below (measured 2026-08-25 on the drawing
 * below — row 22px, button 24px, top -1, bottom +1). `ROW_HEIGHT` is the
 * constant every index in `FileTreeView` is computed from, so the row cannot
 * grow to fit; the control shrinks instead. 17x17 transparent at
 * `--text-faint` is exactly `.asr-cluster__add`, the rail's own launcher
 * riding its own data row.
 */
function RowActionButtons() {
  return (
    <>
      {ACTIONS.map((action) => (
        <button key={action.label} type="button" class="gxe-rowaction" aria-label={action.label}>
          <DeckIcon icon={action.icon} size={CHROME_ICON} />
        </button>
      ))}
    </>
  );
}

/** The shared dock header: three tab chips then the hide control (DL-19.7). */
function DockHeaderChips() {
  return (
    <div class="dock-tabs" role="tablist" aria-label="Side panel">
      <button
        type="button"
        role="tab"
        aria-selected
        class="iconbtn dock-tabs__chip is-active"
        aria-label="Explorer"
      >
        <DeckIcon icon={TreeStructure} size={FEATURE_ICON} filled />
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={false}
        class="iconbtn dock-tabs__chip"
        aria-label="Usage"
      >
        <DeckIcon icon={ChartBar} size={FEATURE_ICON} filled />
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={false}
        class="iconbtn dock-tabs__chip"
        aria-label="Sessions"
      >
        <DeckIcon icon={ClockCounterClockwise} size={FEATURE_ICON} filled />
      </button>
    </div>
  );
}

function HideControl() {
  return (
    <button type="button" class="iconbtn gxe-action" aria-label="Hide the side panel">
      <DeckIcon icon={SidebarSimple} size={FEATURE_ICON} />
    </button>
  );
}

/** A child row of the tree, at depth 1 under the root. */
function ChildRow({ entry }: { entry: Entry }) {
  return (
    <div class="file-tree__row gxe-row" style={{ paddingLeft: "22px" }}>
      <span
        class="file-tree__chevron"
        style={{ visibility: entry.directory ? "visible" : "hidden" }}
      >
        <DeckIcon icon={CaretRight} size={ROW_ICON} />
      </span>
      <span class="file-tree__icon">
        <DeckIcon icon={entry.icon} size={ROW_ICON} />
      </span>
      <span class="file-tree__name">{entry.name}</span>
    </div>
  );
}

/**
 * The root row itself — the half the owner has already settled.
 *
 * Chevron + name, no folder icon: that is what the reference shows, and the
 * chevron plus depth 0 already say "this is the folder everything is in".
 * `withActions` is candidate C's trailing cluster.
 */
function RootRow({
  withActions = false,
  forceShown = false,
  chosen = false,
}: {
  withActions?: boolean;
  forceShown?: boolean;
  chosen?: boolean;
}) {
  return (
    <div
      class={`file-tree__row gxe-row gxe-root ${forceShown ? "is-shown" : ""}`}
      style={{ paddingLeft: "8px" }}
    >
      <span class="file-tree__chevron">
        <DeckIcon icon={CaretDown} size={ROW_ICON} />
      </span>
      <span class="file-tree__name gxe-root__name">{ROOT_NAME}</span>
      {chosen && (
        <span class="gxe-root__actions is-persistent">
          <RowActionButtons />
        </span>
      )}
      {withActions && !chosen && (
        <span class="gxe-root__actions">
          <ActionButtons size={CHROME_ICON} />
        </span>
      )}
    </div>
  );
}

function Tree({
  rootActions = false,
  forceShown = false,
  chosen = false,
}: {
  rootActions?: boolean;
  forceShown?: boolean;
  chosen?: boolean;
}) {
  return (
    <div class="gxe-tree">
      <RootRow withActions={rootActions} forceShown={forceShown} chosen={chosen} />
      {CHILDREN.map((entry) => (
        <ChildRow key={entry.name} entry={entry} />
      ))}
    </div>
  );
}

/** A · the explorer owns a second row under the shared header. */
function CandidateA() {
  return (
    <div class="gxe-column">
      <div class="dock-panel__header">
        <DockHeaderChips />
        <HideControl />
      </div>
      <div class="gxe-actionrow">
        <ActionButtons size={CHROME_ICON} />
      </div>
      <Tree />
    </div>
  );
}

/** B · the four controls join the shared header, ahead of the tab group. */
function CandidateB() {
  return (
    <div class="gxe-column">
      <div class="dock-panel__header">
        <ActionButtons size={CHROME_ICON} />
        <DockHeaderChips />
        <HideControl />
      </div>
      <Tree />
    </div>
  );
}

/** C · the controls ride the root row, hover/focus-revealed (DL-27.18's shape). */
function CandidateC({ forceShown = false }: { forceShown?: boolean }) {
  return (
    <div class="gxe-column">
      <div class="dock-panel__header">
        <DockHeaderChips />
        <HideControl />
      </div>
      <Tree rootActions forceShown={forceShown} />
    </div>
  );
}

/**
 * What the owner chose (2026-08-25): C's placement, but the cluster is
 * PERSISTENT rather than hover-revealed — which removes C's one real cost,
 * that at rest the column showed no actions at all.
 */
function ChosenShape() {
  return (
    <div class="gxe-column">
      <div class="dock-panel__header">
        <DockHeaderChips />
        <HideControl />
      </div>
      <Tree chosen />
    </div>
  );
}

export function ExplorerHeaderVariantsSection() {
  return (
    <>
      <SectionHead
        title="explorer header direction"
        blurb="Where New File / New Folder / Refresh / Collapse All live, given that DL-19.3's header is already the shared tab row. Every column is a drawing in the app's own classes, not the running tree."
      />
      <SpecimenRow>
        <Specimen
          name="A · own action row"
          note="a second 26px row under the shared header — VS Code's shape; needs a new DL §19 rule"
        >
          <CandidateA />
        </Specimen>
        <Specimen
          name="B · in the shared header"
          note="four controls ahead of the tab group — no new row, but the dock host starts carrying per-tab controls"
        >
          <CandidateB />
        </Specimen>
        <Specimen
          name="C · on the root row"
          note="hover/focus-revealed at the row's trailing end — the rail's project header already does this (DL-27.18)"
        >
          <CandidateC />
        </Specimen>
      </SpecimenRow>
      <SpecimenRow>
        <Specimen
          name="C · root row, revealed"
          note="what candidate C looks like while the pointer is on the root row"
        >
          <StateLabel>hover</StateLabel>
          <CandidateC forceShown />
        </Specimen>
        <Specimen
          name="chosen · persistent, 17px controls"
          note="the owner's pick: C's placement, always shown, in the rail launcher's 17px box — .iconbtn's 24px overflows a 22px data row by 1px top and bottom (measured)"
        >
          <ChosenShape />
        </Specimen>
      </SpecimenRow>
    </>
  );
}
