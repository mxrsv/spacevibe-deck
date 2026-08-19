import { agentStatusRailChromeSpecimen, agentStatusRailSpecimen } from "../agent-status-rail";
import {
  agentRailVariantsSpecimen,
  paneTreeSpecimen,
  restingMarkVariantsSpecimen,
  statePaletteSpecimen,
} from "../agent-rail-variants";
import { SectionHead, Specimen } from "../specimen";

export function NavigationSection() {
  return (
    <>
      <SectionHead
        title="Navigation"
        blurb="The shipped AgentRail rendered from seeded stores: one cluster per project in open order (DL-27.9), a chip on single-agent tabs and flat full-width agent rows for multi-agent tabs. The pane-tree markup remains parked behind PANE_TREE_HIDDEN; the gallery labels it as a proposal, never as current chrome."
      />
      <Specimen
        name="Agent status rail"
        note="red fails · yellow needs your eyes · a turning arc works · a green check is done · a quiet ring with a core idles. Rows select; a single-agent chip or a flat multi-agent row focuses the exact pane."
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
        note="historical comparison — R4 is the shipping idle mark; the other treatments are unselected proposals"
        surface="none"
      >
        {restingMarkVariantsSpecimen()}
      </Specimen>
      <Specimen
        name="State palette · current vocabulary"
        note="five shipping states: failed · asked · working · done · idle; this reference isolates their marks while the real rail above supplies the full row semantics"
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
        name="Agent status rail · in the window shell"
        note="the same rail mounted as the sidebar — with the Tools footer — beside the real frame and stage strip; a chip click rings the pane it focused"
        surface="none"
        tall
      >
        {agentStatusRailChromeSpecimen()}
      </Specimen>
    </>
  );
}
