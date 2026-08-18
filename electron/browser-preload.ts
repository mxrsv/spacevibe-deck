/**
 * Preload for the browser panel's web content — NOT for Deck's own window
 * (that is `preload.ts`, and the two must never be confused: this one runs
 * beside pages Deck did not write).
 *
 * It exposes nothing. `contextBridge` is not used and no global is installed,
 * so the page gains no reach into the host from this file. The one thing it
 * does is carry grabs outward, and decide which ones deserve carrying.
 *
 * Why a DOM event and not a shared global: react-grab has to run in the page's
 * MAIN world to read React's fiber expandos, while this preload runs in an
 * isolated world. The two worlds share the DOM and nothing else, so a
 * `CustomEvent` on `window` is the only channel between them — its `detail` is
 * structured-cloned across the boundary, which is why the payload is a plain
 * JSON string rather than an object graph.
 *
 * **The page can forge that event**, and a grab ends up pasted into a live
 * agent session, so forging it is worth something to an attacker: a page in the
 * panel could dispatch thousands a second and flood the pane, or slip one
 * crafted line in front of the user's next Enter. Two gates below stop that,
 * and both live HERE rather than in the main world, because anything in the
 * main world is code the page can read and call itself.
 */
import { ipcRenderer } from 'electron';

const GRAB_EVENT = 'deck:browser-grab';

/**
 * How long a real user gesture vouches for a grab.
 *
 * A grab is the tail of ⌘C or a click: the gesture is milliseconds old by the
 * time the content has been generated. Three seconds is generous for a slow
 * `generateSnippet` (its own deadline is two) and short enough that a page
 * cannot bank one click and replay grabs for the rest of the session.
 */
const GESTURE_WINDOW_MS = 3000;

/** Floor between two forwarded grabs. A human cannot produce two in 250ms. */
const MIN_INTERVAL_MS = 250;

/**
 * `tsconfig.electron.json` compiles this tree with `lib: ["ES2022"]` and no
 * DOM, because everything else under `electron/` is a Node process and pulling
 * the DOM lib in for one file would give the main process `setTimeout`,
 * `fetch` and friends with browser signatures.
 *
 * So the DOM names this file needs are declared here, as narrowly as they are
 * used. `detail` is `unknown` on purpose — it arrives from the page.
 */
interface PageEvent {
  readonly detail?: unknown;
  /**
   * False for anything a script dispatched. The browser sets it, and page
   * script cannot — which is the entire basis of the gesture gate.
   */
  readonly isTrusted?: boolean;
}
declare const window: {
  addEventListener(
    type: string,
    handler: (event: PageEvent) => void,
    options?: { capture?: boolean },
  ): void;
};

let lastGestureAt = 0;
let lastForwardAt = 0;

function now(): number {
  return Date.now();
}

/**
 * Remember genuine user input. Capture phase, so a page that stops propagation
 * on its own handlers cannot also starve this — the listener runs first.
 */
for (const gesture of ['keydown', 'pointerdown', 'mousedown']) {
  window.addEventListener(
    gesture,
    (event) => {
      if (event.isTrusted === true) {
        lastGestureAt = now();
      }
    },
    { capture: true },
  );
}

window.addEventListener(GRAB_EVENT, (event) => {
  const detail = event.detail;
  if (typeof detail !== 'string') {
    return;
  }
  const at = now();
  if (at - lastGestureAt > GESTURE_WINDOW_MS) {
    // No recent human input: this grab was manufactured by the page.
    return;
  }
  if (at - lastForwardAt < MIN_INTERVAL_MS) {
    return;
  }
  lastForwardAt = at;
  ipcRenderer.send(GRAB_EVENT, detail);
});
