import type { ComponentType } from "preact";
import { AttentionDirectionSection } from "./sections/attention-direction";
import { BoardSection } from "./sections/board-section";
import { ChromeSection } from "./sections/chrome-section";
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
  {
    id: "launch-profiles",
    label: "launch profiles",
    Section: LaunchProfilesSection,
  },
];
