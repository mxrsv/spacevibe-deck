import type { ComponentType } from "preact";
import { lazy } from "preact/compat";

/* Every section loads on demand: importing them all up front made each
   gallery page load transform and fetch nearly the whole app's module graph
   (334 `src/` modules on 2026-10-03) to show one section. A section's own
   stylesheet now arrives with it, so it must import every stylesheet it
   draws with rather than lean on a neighbour having loaded it. */
const AgentBoardSection = lazy(() =>
  import("./sections/agent-board-section").then((m) => m.AgentBoardSection),
);
const AttentionSection = lazy(() =>
  import("./sections/attention-section").then((m) => m.AttentionSection),
);
const BoardSection = lazy(() => import("./sections/board-section").then((m) => m.BoardSection));
const ChromeSection = lazy(() => import("./sections/chrome-section").then((m) => m.ChromeSection));
const ExplorerTreeSection = lazy(() =>
  import("./sections/explorer-tree-section").then((m) => m.ExplorerTreeSection),
);
const MatrixSection = lazy(() => import("./sections/matrix-section").then((m) => m.MatrixSection));
const NavigationSection = lazy(() =>
  import("./sections/navigation-section").then((m) => m.NavigationSection),
);
const AgentUsageSection = lazy(() =>
  import("./sections/navigation-section").then((m) => m.AgentUsageSection),
);
const RowBadgeSection = lazy(() =>
  import("./sections/row-badge-section").then((m) => m.RowBadgeSection),
);
const OverlaysSection = lazy(() =>
  import("./sections/overlays-section").then((m) => m.OverlaysSection),
);
const PopoversSection = lazy(() =>
  import("./sections/popovers-section").then((m) => m.PopoversSection),
);
const RowsSection = lazy(() => import("./sections/rows-section").then((m) => m.RowsSection));
const SeamSection = lazy(() => import("./sections/seam-section").then((m) => m.SeamSection));
const SettingsDirectionSection = lazy(() =>
  import("./sections/settings-direction").then((m) => m.SettingsDirectionSection),
);
const ToolbarSection = lazy(() =>
  import("./sections/toolbar-section").then((m) => m.ToolbarSection),
);
const TokensSection = lazy(() => import("./sections/tokens-section").then((m) => m.TokensSection));
const LaunchProfilesSection = lazy(() =>
  import("./sections/launch-profiles-section").then((m) => m.LaunchProfilesSection),
);
const ChangesSpecimensSection = lazy(() =>
  import("./sections/changes-specimens-section").then((m) => m.ChangesSpecimensSection),
);

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
 * A comparison page leaves once its direction ships or is dropped — the
 * registry entry and its files both go (2026-10-03); git history keeps the
 * drawing a choice was made against. A comparison whose `current` column is
 * no longer current only shows treatments that lost.
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
  { id: "row-badge", label: "row badge", Section: RowBadgeSection },
  { id: "agent-usage", label: "agent usage", Section: AgentUsageSection },
  { id: "toolbar", label: "feature toolbar", Section: ToolbarSection },
  { id: "attention", label: "needs-you chip", Section: AttentionSection },
  { id: "seams", label: "seam system", Section: SeamSection },
  { id: "popovers", label: "popovers", Section: PopoversSection },
  { id: "overlays", label: "overlays", Section: OverlaysSection },
  { id: "board", label: "open board", Section: BoardSection },
  { id: "agent-board", label: "agent board", Section: AgentBoardSection },
  { id: "explorer-tree", label: "explorer tree", Section: ExplorerTreeSection },
  {
    id: "launch-profiles",
    label: "launch profiles",
    Section: LaunchProfilesSection,
  },
  { id: "changes-specimens", label: "changes specimens", Section: ChangesSpecimensSection },
];
