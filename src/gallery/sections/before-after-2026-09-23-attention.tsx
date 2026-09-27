import { Specimen } from "../specimen";
import { NeedsMeRailPair } from "./before-after-2026-09-23-attention-rail";
import { NotificationPair } from "./before-after-2026-09-23-attention-notify";
import { BoardDecisionPair } from "./before-after-2026-09-23-attention-board";
import "./before-after-2026-09-23-attention.css";

/**
 * The attention group of the 2026-09-23 before / after section: the three
 * proposals about noticing that an agent needs you. One file per pair so
 * each stays readable; this one only orders them.
 */
export function AttentionPairs() {
  return (
    <>
      <Specimen
        name="1 · Notifications you can act on, plus a dock badge"
        note="Wave 1 · small · Electron only (main-process Notification click and app badge) · no AGENTS.md fork."
        surface="none"
      >
        <NotificationPair />
      </Specimen>
      <Specimen
        name="2 · Needs me louder than working on the rail"
        note="Wave 1 · small to medium · renderer, so it reaches both hosts · DESIGN-LANGUAGE fork (§27)."
        surface="none"
      >
        <NeedsMeRailPair />
      </Specimen>
      <Specimen
        name="3 · Allow / Deny from the Board card"
        note="Wave 3 · medium · Electron (hook bridge) plus renderer · touches the user's Claude settings, needs consent copy · partly reverses DECK-43."
        surface="none"
      >
        <BoardDecisionPair />
      </Specimen>
    </>
  );
}
