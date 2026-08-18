/**
 * The browser ON the stage — the browser twin of `StageSurface`
 * (src/files/ui/stage-surface.tsx), landed when the docked column retired.
 *
 * Same reasoning as that component: `App` has no render harness in this
 * repo, so the mount condition ("the browser tab holds the stage") must live
 * in a component of its own to be assertable. And the same geometry: the
 * surface COVERS `.stage__tabs` instead of unmounting it, so the terminal
 * grid keeps its measured size and taking the stage back costs no xterm
 * reflow and no PTY resize round-trip (spec §4.2's rule, extended here).
 *
 * The rectangle it occupies — including the insets that keep it clear of the
 * explorer column — is `.stage__surface` in styles.css; the browser variant
 * only zeroes the padding so the native view meets the surface's edges.
 */
import { browserSurfaceActive } from './browser-store';
import type { BrowserClient } from './browser-client';
import { BrowserPanel } from './browser-panel';

export interface BrowserSurfaceProps {
  /** Closes the browser TAB — the chip leaves the strip, the page is kept. */
  readonly onClose: () => void;
  /** Hidden while a DOM overlay covers the stage; see `App`. */
  readonly hidden: boolean;
  readonly client?: BrowserClient;
}

export function BrowserSurface(props: BrowserSurfaceProps) {
  if (!browserSurfaceActive.value) {
    return null; // a terminal tab or a file surface holds the stage
  }
  return (
    <div class="stage__surface stage__surface--browser">
      <BrowserPanel onClose={props.onClose} hidden={props.hidden} client={props.client} />
    </div>
  );
}
