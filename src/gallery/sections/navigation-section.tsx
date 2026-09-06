import { agentStatusRailChromeSpecimen, agentStatusRailSpecimen } from "../agent-status-rail";
import {
  agentRailVariantsSpecimen,
  multiAgentGroupingSpecimen,
  paneTreeSpecimen,
  restingMarkVariantsSpecimen,
  statePaletteSpecimen,
} from "../agent-rail-variants";
import { railSimplicityLadderSpecimen, railStructureSpecimen } from "../rail-structure-variants";
import { SectionHead, Specimen } from "../specimen";

export function NavigationSection() {
  return (
    <>
      <SectionHead
        title="Navigation"
        blurb="The shipped AgentRail rendered from seeded stores: one cluster per project in open order (DL-27.9), a chip on single-agent tabs and flat full-width agent rows for multi-agent tabs — those rows standing inside a neutral frame since 2026-08-20 (DL-27.19). The pane-tree markup remains parked behind PANE_TREE_HIDDEN; the gallery labels it as a proposal, never as current chrome."
      />
      <Specimen
        name="Agent status rail"
        note="one static dot shape: red fails · yellow needs your eyes · neutral means working; done and idle paint no mark. Rows never dim by state."
        surface="none"
      >
        {agentStatusRailSpecimen()}
      </Specimen>
      <Specimen
        name="Row-structure candidates"
        note="historical comparison only — A records the retired two-line shape; B–D are unselected proposals and none is the shipping rail"
        surface="none"
      >
        {agentRailVariantsSpecimen()}
      </Specimen>
      <Specimen
        name="Resting mark candidates"
        note="historical comparison only — every candidate is retired; done and idle now paint no mark"
        surface="none"
      >
        {restingMarkVariantsSpecimen()}
      </Specimen>
      <Specimen
        name="State palette · current vocabulary"
        note="five semantic states remain, but only failed · asked · working paint the shared dot; title and accessible text retain all five words"
        surface="none"
      >
        {statePaletteSpecimen()}
      </Specimen>
      <Specimen
        name="Pane tree · parked proposal"
        note="not current: PANE_TREE_HIDDEN keeps multi-agent panes flat; this retained specimen shows the reversible elbow-tree direction only"
        surface="none"
      >
        {paneTreeSpecimen()}
      </Specimen>
      <Specimen
        name="Multi-agent grouping · candidates"
        note="B3 shipped on 2026-08-20 as DL-27.19 — the neutral frame. A is the flat rail it replaced; B1/B2 are the hairline rule and the wash it was judged against; B4 is the same frame in the tab's own dot colour, turned down because the status dot owns red and yellow; C is the parked elbow tree. Two multi-agent tabs sit back to back on purpose — that pair is what a grouping mark has to survive."
        surface="none"
      >
        {multiAgentGroupingSpecimen()}
      </Specimen>
      <Specimen
        name="Rail simplicity ladder · candidates"
        note="three amounts of the same information, same fixture, same width. L1 removes ink (no sentence, no age); L2 removes rows (one per tab, agents as glyphs badged only when loud); L3 is the floor (name and mark). L0 is the shipped rail mounted above. Stopping at L1 means the problem was text density; stopping at L2 means it was row count."
        surface="none"
      >
        {railSimplicityLadderSpecimen()}
      </Specimen>
      <Specimen
        name="Rail structure · candidates"
        note="the unit itself changes: M1/M2 draw each tab as a small split map with one region per pane, at 275px and at the 200px sidebar floor; P makes the project the row and names the agent that wants you. Proposals from the 2026-08-19 review — none is selected, and the map has no DL rule yet."
        surface="none"
      >
        {railStructureSpecimen()}
      </Specimen>
      <Specimen
        name="Agent status rail · in the window shell"
        note="the same rail mounted as the sidebar — with the Tools footer — beside the real frame and stage strip"
        surface="none"
        tall
      >
        {agentStatusRailChromeSpecimen()}
      </Specimen>
    </>
  );
}
