import { SectionHead } from "../specimen";
import { AttentionPairs } from "./before-after-2026-09-23-attention";
import { LaunchPairs } from "./before-after-2026-09-23-launch";
import { ReviewPairs } from "./before-after-2026-09-23-review";

/**
 * Before / after pairs for the 2026-09-23 product review, one per proposed
 * feature, for the owner to compare by eye before any of them is planned.
 * Split by the loop step each feature serves — noticing an agent, handing it
 * a task, finishing its work — so no single file carries nine specimens.
 * Nothing here ships; each `after` note names the file a chosen candidate
 * would change and the fork it touches, if any.
 */
export function BeforeAfter20260923Section() {
  return (
    <>
      <SectionHead
        title="Before / after · product review 2026-09-23"
        blurb="Nine proposals. Left is what ships today, right is the candidate. Where Deck has no such surface yet, the after column is a gallery drawing in the app's own tokens, and its note says so."
      />
      <AttentionPairs />
      <LaunchPairs />
      <ReviewPairs />
    </>
  );
}
