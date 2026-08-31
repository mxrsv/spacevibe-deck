import type { ComponentType } from "preact";
import { AttentionDirectionSection } from "./sections/attention-direction";
import { BoardSection } from "./sections/board-section";
import { ChromeSection } from "./sections/chrome-section";
import { ExplorerTreeSection } from "./sections/explorer-tree-section";
import { MatrixSection } from "./sections/matrix-section";
import { NavigationSection } from "./sections/navigation-section";
import { OverlaysSection } from "./sections/overlays-section";
import { PopoversSection } from "./sections/popovers-section";
import { RowsSection } from "./sections/rows-section";
import { SeamSection } from "./sections/seam-section";
import { SettingsDirectionSection } from "./sections/settings-direction";
import { ToolbarSection } from "./sections/toolbar-section";
import { TokensSection } from "./sections/tokens-section";
import { LaunchProfilesSection } from "./sections/launch-profiles-section";

export interface GallerySection {
  readonly id: string;
  readonly label: string;
  readonly Section: ComponentType;
}

/**
 * Order runs from the selected system outward: direction tokens, controls,
 * shell, then the surfaces that cover it. Historical comparison pages stay
 * out of this registry so the review surface shows one visual language only.
 *
 * `unread mark direction` was registered on 2026-08-25 and taken out the same
 * day: its candidate C shipped, so the real rail in every section below now
 * draws it and a four-way comparison would show three treatments that lost
 * beside a `current` column that is no longer current. The file stays in the
 * tree as the record of that review, unimported like the other parked
 * comparison pages.
 *
 * `explorer header direction` was registered on 2026-08-25 and taken out the
 * same day the work shipped: its candidate C is what the real tree draws now,
 * so a three-way comparison would show two treatments that lost beside a
 * `current` column that is no longer current. The file stays in the tree as
 * the record of that review, unimported like the other parked comparison
 * pages — and `explorer tree` takes its slot, mounting the shipping
 * `FileTreeView` where the drawing used to stand.
 *
 * `state matrix` returned on 2026-08-13. It was parked while the direction was
 * nine fixed hex values, where four theme columns would have been four copies
 * of one picture. Now that the direction derives from `--bg`/`--tone`, the
 * matrix is the evidence that the rebuild holds — so it sits directly under
 * `window chrome`, next to the shell it cross-checks.
 */
export const GALLERY_SECTIONS: readonly GallerySection[] = [
  { id: "tokens", label: "direction tokens", Section: TokensSection },
  { id: "rows", label: "config rows", Section: RowsSection },
  {
    id: "settings-direction",
    label: "light/dark settings",
    Section: SettingsDirectionSection,
  },
  { id: "chrome", label: "window chrome", Section: ChromeSection },
  { id: "matrix", label: "native detail matrix", Section: MatrixSection },
  { id: "navigation", label: "navigation", Section: NavigationSection },
  {
    id: "attention",
    label: "attention direction",
    Section: AttentionDirectionSection,
  },
  { id: "toolbar", label: "feature toolbar", Section: ToolbarSection },
  { id: "seams", label: "seam system", Section: SeamSection },
  { id: "popovers", label: "popovers", Section: PopoversSection },
  { id: "overlays", label: "overlays", Section: OverlaysSection },
  { id: "board", label: "open board", Section: BoardSection },
  { id: "explorer-tree", label: "explorer tree", Section: ExplorerTreeSection },
  /* PARKED 2026-08-30, the same day it was registered — the `unread-mark-variants`
     precedent again: the owner picked `SquareHalf` and `GitFork`, they shipped into
     `worktree-card-menus.tsx`'s `ACTION_GLYPHS`, and a comparison whose incumbent
     column is no longer the incumbent shows six treatments that lost beside two that
     are simply what the menu draws. `action-glyph-variants.tsx` and its stylesheet
     stay in the tree as the drawn record of what the choice was made against. */
  /* PARKED 2026-08-27, the `unread-mark-variants` precedent: the closed-strip
     actions candidate SHIPPED into `worktree-card-strip.tsx` /
     `worktree-card-menus.tsx`, so its "per-pane — what ships" control column
     stopped being current and the comparison started lying. The specimen files
     stay in the tree as the drawn record of what was chosen and what was turned
     down; the registry entry and its import are what go. */
  {
    id: "launch-profiles",
    label: "launch profiles",
    Section: LaunchProfilesSection,
  },
];
