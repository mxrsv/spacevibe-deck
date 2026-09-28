import type { PaneRect } from "../../lib/pane-geometry";
import { reducedMotion, settled, slide } from "./space-motion";

/**
 * The space slide (DL-35.2). Only the current space holds a live terminal:
 * the incoming tab is shown by `TerminalManager.show()` as it always was, and
 * the outgoing one is released by `hide()` as it always was. What slides out
 * is a GHOST — the outgoing panes' last rows as plain text, read through
 * `serializePane` before `hide()`, laid in the rects those panes had. No xterm
 * is moved, cloned or kept alive for the animation.
 *
 * The stage element is `App`'s `.stage__tabs`, never an element a
 * `TerminalManager` owns: those write `style.display` and must not also carry
 * a transform.
 */

/** xterm's own line height in `pane.ts`; the ghost sets text on the same grid. */
const TERMINAL_LINE_HEIGHT = 1.25;
/** The pane's border, which the text sits inside. */
const PANE_BORDER_PX = 1;

export type SlideDirection = 1 | -1;

export interface SpaceSlideDeps {
  /** `.stage__tabs` — the element that slides in, carrying the incoming tab. */
  readonly stage: () => HTMLElement | null;
  /** The outgoing tab's pane rects, read before it hides. */
  readonly rects: () => readonly PaneRect[];
  /** A pane's last `rows` rows as plain text (`TabManager.serializePane`). */
  readonly snapshot: (paneId: number, rows: number) => string | null;
  /** The terminal face, so the ghost's text sits where xterm drew it. */
  readonly font: () => { readonly family: string; readonly size: number };
}

function ghostPane(rect: PaneRect, origin: DOMRect, text: string): HTMLElement {
  const pane = document.createElement("div");
  pane.className = "space-ghost__pane";
  pane.style.left = `${rect.left - origin.left}px`;
  pane.style.top = `${rect.top - origin.top}px`;
  pane.style.width = `${rect.right - rect.left}px`;
  pane.style.height = `${rect.bottom - rect.top}px`;
  const body = document.createElement("pre");
  body.className = "space-ghost__text";
  body.textContent = text;
  pane.append(body);
  return pane;
}

function buildGhost(deps: SpaceSlideDeps, stage: HTMLElement): HTMLElement {
  const origin = stage.getBoundingClientRect();
  const font = deps.font();
  const rowHeight = font.size * TERMINAL_LINE_HEIGHT;
  const ghost = document.createElement("div");
  ghost.className = "space-ghost";
  ghost.setAttribute("aria-hidden", "true");
  ghost.style.left = `${stage.offsetLeft}px`;
  ghost.style.top = `${stage.offsetTop}px`;
  ghost.style.width = `${stage.offsetWidth}px`;
  ghost.style.height = `${stage.offsetHeight}px`;
  ghost.style.fontFamily = font.family;
  ghost.style.fontSize = `${font.size}px`;
  ghost.style.lineHeight = String(TERMINAL_LINE_HEIGHT);
  for (const rect of deps.rects()) {
    const rows = Math.max(1, Math.floor((rect.bottom - rect.top - 2 * PANE_BORDER_PX) / rowHeight));
    ghost.append(ghostPane(rect, origin, deps.snapshot(rect.id, rows) ?? ""));
  }
  return ghost;
}

export interface SpaceSlider {
  /**
   * Read the outgoing tab NOW, and return what plays once the incoming tab is
   * shown. Under reduced motion it reads nothing and plays nothing.
   */
  capture(direction: SlideDirection): () => void;
  /** End a slide in flight at once — its ghost goes, the stage lands. */
  finish(): void;
}

export function createSpaceSlider(deps: SpaceSlideDeps): SpaceSlider {
  let inFlight: readonly Animation[] = [];

  const finish = (): void => {
    inFlight.forEach((animation) => animation.finish());
    inFlight = [];
  };

  return {
    finish,
    capture(direction) {
      finish();
      const stage = deps.stage();
      const host = stage?.parentElement ?? null;
      if (stage === null || host === null || reducedMotion()) return () => undefined;
      const ghost = buildGhost(deps, stage);
      return () => {
        stage.after(ghost);
        host.classList.add("is-sliding");
        const animations = [slide(stage, direction, 0), slide(ghost, 0, -direction)].filter(
          (animation): animation is Animation => animation !== null,
        );
        inFlight = animations;
        void settled(animations).then(() => {
          ghost.remove();
          // A newer slide that already started keeps the clip it needs.
          if (inFlight === animations || inFlight.length === 0) {
            inFlight = [];
            host.classList.remove("is-sliding");
          }
        });
      };
    },
  };
}
