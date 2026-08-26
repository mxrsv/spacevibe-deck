import { agentStatusRailChromeSpecimen, agentStatusRailSpecimen } from "../agent-status-rail";
import {
  agentRailVariantsSpecimen,
  multiAgentGroupingSpecimen,
  paneTreeSpecimen,
  restingMarkVariantsSpecimen,
  statePaletteSpecimen,
} from "../agent-rail-variants";
import { railSimplicityLadderSpecimen, railStructureSpecimen } from "../rail-structure-variants";
import { railColorRuleSpecimen, railWorktreeCardsSpecimen } from "../rail-worktree-cards";
import { SIDEBAR_WIDTH_MIN } from "../../settings/settings-schema";
import { SectionHead, Specimen } from "../specimen";

export function NavigationSection() {
  return (
    <>
      <SectionHead
        title="Navigation"
        blurb="The shipped AgentRail rendered from seeded stores: one cluster per project in open order (DL-27.9), its tabs grouped under the checkout they run in since 2026-08-25 (DL-27.23) — deck carries a live main, a live redesign/phase-1-2 and a history-only electron-migration group — a chip on single-agent tabs and flat full-width agent rows for multi-agent tabs, those rows standing inside a neutral frame since 2026-08-20 (DL-27.19). The pane-tree markup remains parked behind PANE_TREE_HIDDEN; the gallery labels it as a proposal, never as current chrome."
      />
      <Specimen
        name="Agent status rail"
        note="project → worktree → agent, all three on one 31px left edge (DL-27.23); a group is a label with one launcher and no caret (DL-27.24). One static dot shape: red fails · yellow needs your eyes · neutral means working; done and idle paint no mark. Rows never dim by state."
        surface="none"
      >
        {agentStatusRailSpecimen()}
      </Specimen>
      <Specimen
        name="Worktree cards · proposal (owner mockup, 2026-08-25)"
        note="NOT the shipping rail. The box moves up a level: a CHECKOUT becomes a card that opens onto its agents, so the tab tier leaves the rail. Left is the closed picture (mark · branch · agent count · age · caret, then the path, then agents as badged chips); right is one card open onto per-agent rows, each stating a status word. Four unresolved divergences are drawn rather than normalised — a card is a checkout and not a tab; Running/Thinking/Idle replace failed/asked/working/done/idle, bringing green and --magenta back into chrome against DL-27.3 and DL-3.6; a status word replaces the agent's newest sentence (DL-27.15); and the ACTIVE checkout is wrapped whole in accent where DL-21.1 gives selection a neutral frame, so selection and liveness share one hue. The closed siblings dropping to one line is the mockups' own inconsistency, kept visible."
        surface="none"
      >
        {railWorktreeCardsSpecimen()}
      </Specimen>
      <Specimen
        name="Worktree cards · the colour rule"
        note="ONE hue, ONE meaning, no hue twice. Two faults are already fixed in the sheet rather than offered here: running and thinking shared a category but wore green and magenta, and --green was doing double duty as both the running hue and the active card's frame. Green now means the active checkout only; yellow means waiting on you; red means failed; --accent means a count (+N); neutral means idle, done and every resting surface. What is left to pick is which hue BUSY takes — A neutral (the quietest, but NOT rule-free: DL-27.3 says working is not a dot at all but WorkspaceSpinner in a 14px box, and that done/idle share the gray dot; AGENTS.md's 'neutral means working' line quotes the reversed morning version), B --magenta, C --cyan. One --gxwc-busy line separates the three columns; everything else is identical."
        surface="none"
      >
        {railColorRuleSpecimen()}
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
        name="Recent activity · normal sidebar"
        note="current proposal awaiting owner eye review · five global sessions rendered by the production RecentSessionActivity inside the shipping AgentRail and window shell"
        surface="none"
        tall
      >
        {agentStatusRailChromeSpecimen()}
      </Specimen>
      <Specimen
        name="Recent activity · compact sidebar"
        note="current proposal awaiting owner eye review · the same production shell at the persisted sidebar floor; summary copy yields before the glyph and relative time"
        surface="none"
        tall
      >
        <div style={{ height: "100%", "--sidebar-w": `${SIDEBAR_WIDTH_MIN}px` }}>
          {agentStatusRailChromeSpecimen()}
        </div>
      </Specimen>
    </>
  );
}
