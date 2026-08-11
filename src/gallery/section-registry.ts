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
 * Order runs from the system outward: what the visuals are made of, then the
 * one control, then the shell, then the surfaces that cover it. Adding a
 * section is one entry here plus one file under `sections/`.
 */
export const GALLERY_SECTIONS: readonly GallerySection[] = [
  { id: "tokens", label: "tokens & spread", Section: TokensSection },
  { id: "rows", label: "config rows", Section: RowsSection },
  { id: "chrome", label: "window chrome", Section: ChromeSection },
  { id: "popovers", label: "popovers", Section: PopoversSection },
  { id: "overlays", label: "overlays", Section: OverlaysSection },
  { id: "board", label: "open board", Section: BoardSection },
];
