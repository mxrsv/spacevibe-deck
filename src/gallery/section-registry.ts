import type { ComponentType } from "preact";
import { BoardSection } from "./sections/board-section";
import { ChromeSection } from "./sections/chrome-section";
import { OverlaysSection } from "./sections/overlays-section";
import { PopoversSection } from "./sections/popovers-section";
import { RowsSection } from "./sections/rows-section";
import { TokensSection } from "./sections/tokens-section";

export interface GallerySection {
  readonly id: string;
  readonly label: string;
  readonly Section: ComponentType;
}

/**
 * Order runs from the selected system outward: direction tokens, controls,
 * shell, then the surfaces that cover it. Historical comparison pages stay
 * out of this registry so the review surface shows one visual language only.
 */
export const GALLERY_SECTIONS: readonly GallerySection[] = [
  { id: "tokens", label: "direction tokens", Section: TokensSection },
  { id: "rows", label: "config rows", Section: RowsSection },
  { id: "chrome", label: "window chrome", Section: ChromeSection },
  { id: "popovers", label: "popovers", Section: PopoversSection },
  { id: "overlays", label: "overlays", Section: OverlaysSection },
  { id: "board", label: "open board", Section: BoardSection },
];
