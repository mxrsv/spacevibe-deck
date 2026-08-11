/**
 * Preload for the browser panel's web content — NOT for Deck's own window
 * (that is `preload.ts`, and the two must never be confused: this one runs
 * beside pages Deck did not write).
 *
 * It exposes nothing. `contextBridge` is not used and no global is installed,
 * so the page gains no reach into the host from this file. The one thing it
 * does is carry grabs outward.
 *
 * Why a DOM event and not a shared global: react-grab has to run in the page's
 * MAIN world to read React's fiber expandos, while this preload runs in an
 * isolated world. The two worlds share the DOM and nothing else, so a
 * `CustomEvent` on `window` is the only channel between them — its `detail` is
 * structured-cloned across the boundary, which is why the payload is a plain
 * JSON string rather than an object graph.
 *
 * The page can forge this event. That is expected and handled where it
 * matters: the host parses defensively, the text is length-capped, and the
 * renderer never auto-submits it into an agent.
 */
import { ipcRenderer } from "electron";

const GRAB_EVENT = "deck:browser-grab";

/**
 * `tsconfig.electron.json` compiles this tree with `lib: ["ES2022"]` and no
 * DOM, because everything else under `electron/` is a Node process and pulling
 * the DOM lib in for one file would give the main process `setTimeout`,
 * `fetch` and friends with browser signatures.
 *
 * So the two DOM names this file needs are declared here, as narrowly as they
 * are used. `detail` is `unknown` on purpose — it arrives from the page.
 */
declare const window: {
  addEventListener(
    type: string,
    handler: (event: { readonly detail?: unknown }) => void,
  ): void;
};

window.addEventListener(GRAB_EVENT, (event) => {
  const detail = event.detail;
  if (typeof detail !== "string") {
    return;
  }
  ipcRenderer.send(GRAB_EVENT, detail);
});
