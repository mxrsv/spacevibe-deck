import { agentStatusRailChromeSpecimen, agentStatusRailSpecimen } from "../agent-status-rail";
import {
  agentRailVariantsSpecimen,
  multiAgentGroupingSpecimen,
  paneTreeSpecimen,
  restingMarkVariantsSpecimen,
  statePaletteSpecimen,
} from "../agent-rail-variants";
import { railSimplicityLadderSpecimen, railStructureSpecimen } from "../rail-structure-variants";
import {
  railColorRuleSpecimen,
  railFocusMarkSpecimen,
  railWorktreeCardsSpecimen,
} from "../rail-worktree-cards";
import { SIDEBAR_WIDTH_MIN } from "../../settings/settings-schema";
import { SectionHead, Specimen } from "../specimen";

export function NavigationSection() {
  return (
    <>
      <SectionHead
        title="Navigation"
        blurb="The shipped AgentRail rendered from seeded stores: one cluster per project in open order (DL-27.9), each checkout grouped under its own worktree card since 2026-08-26 (DL-27.23/DL-27.24, amended) — a checkout is a boxed, expandable card whose agent rows are every pane running in it, flattened across whichever tabs hold them. There is no tab tier and no per-agent chip any more, and DL-27.19's neutral frame around a multi-agent tab is deleted along with the tab row it used to wrap. The retired pane-tree markup stays only as a historical comparison below; the constant that used to gate it (PANE_TREE_HIDDEN) no longer exists in the source."
      />
      <Specimen
        name="Agent status rail"
        note="project → worktree → agent, all three on one 31px left edge (DL-27.23); a group is a label with one launcher and no caret (DL-27.24). One static dot shape: red fails · yellow needs your eyes · neutral means working; done and idle paint no mark. Rows never dim by state."
        surface="none"
      >
        {agentStatusRailSpecimen()}
      </Specimen>
      <Specimen
        name="Worktree card"
        note="the shipped WorktreeCard in isolation, at rail width: closed and open side by side. ai-terminal's five panes are fed by three different tabs, flattened onto one card — the card's load-bearing claim, invisible in a fixture where every card's panes come from a single tab."
        surface="none"
      >
        {railWorktreeCardsSpecimen()}
      </Specimen>
      <Specimen
        name="Worktree card · the colour rule"
        note="the one value the card sheet still leaves open (design §13, Task 10's gate): which hue --asr-card-busy takes. A is the shipped default; B and C restate that one custom property under a gallery-only override."
        surface="none"
      >
        {railColorRuleSpecimen()}
      </Specimen>
      <Specimen
        name="Worktree card · the focused agent row"
        note="which agent holds the keyboard (DL-27.22), drawn three ways after the owner asked for it louder (2026-08-26). A is the shipped default and keeps DL-27.22's one-signifier rule; B and C add a second one and amend it. Each column is one override of --asr-card-focus-bg / -frame / -bar; the focused row is deliberately a WORKING row, since the rim glow is what the mark has to survive."
        surface="none"
      >
        {railFocusMarkSpecimen()}
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
        note="not current: the worktree card renders multi-agent panes as flat rows with no tree at all, and the PANE_TREE_HIDDEN constant that used to gate this direction is gone from the source; this retained specimen shows the elbow-tree direction only, as a historical comparison"
        surface="none"
      >
        {paneTreeSpecimen()}
      </Specimen>
      <Specimen
        name="Multi-agent grouping · candidates"
        note="B3 shipped on 2026-08-20 as DL-27.19 — the neutral frame — and was retired 2026-08-26 when the worktree card replaced the tab tier; the card's own box now says what the frame said. A is the flat rail it replaced; B1/B2 are the hairline rule and the wash it was judged against; B4 is the same frame in the tab's own dot colour, turned down because the status dot owns red and yellow; C is the parked elbow tree. Two multi-agent tabs sit back to back on purpose — that pair is what a grouping mark has to survive."
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
