import {
  agentStatusRailChromeSpecimen,
  agentStatusRailSpecimen,
} from "../agent-status-rail";
import { SectionHead, Specimen } from "../specimen";

export function NavigationSection() {
  return (
    <>
      <SectionHead
        title="Navigation"
        blurb="One rail, one row per live agent: a pinned Needs you block over everything else in recency order, and a single status mark at the right edge. Chosen 2026-08-16; the compared alternatives were removed the same day."
      />
      <Specimen
        name="Agent status rail"
        note="yellow asks · accent means a result is waiting · a turning arc works · a hairline ring rests. Press the buttons to watch a row arrive in the pinned block."
        surface="none"
      >
        {agentStatusRailSpecimen()}
      </Specimen>
      <Specimen
        name="Agent status rail · in the window shell"
        note="the same rail mounted as the sidebar, beside the real frame, stage strip and status bar"
        surface="none"
        tall
      >
        {agentStatusRailChromeSpecimen()}
      </Specimen>
    </>
  );
}
