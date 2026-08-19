/**
 * Browser tab state — window-scoped module store of signals (R5).
 *
 * The browser is a tab on the strip whose surface covers the stage (DL-18.8);
 * its *content* lives in the host (a native view), so this store holds only
 * what the chrome around it draws, plus the one piece of behaviour worth
 * testing on its own: what happens to a grab.
 */
import { signal } from "@preact/signals";
import { nextOpenSequence, UNSEQUENCED } from "../lib/open-sequence";
import type { BrowserClient, BrowserGrab, BrowserState } from "./browser-client";
import { formatGrab, grabSummary } from "./grab-format";

export const EMPTY_STATE: BrowserState = {
  url: "",
  title: "",
  canGoBack: false,
  canGoForward: false,
  loading: false,
  inspect: false,
  error: null,
};

/**
 * Whether the browser tab exists on the strip. The chip renders while this
 * is true; the host view follows `browserSurfaceActive`, not this — a chip
 * can sit on the strip with its page hidden behind a terminal.
 */
export const browserOpen = signal(false);

/**
 * Where the browser chip sits in the strip's one open order
 * (`lib/open-sequence.ts`) — the browser's answer to `SurfaceStrip.orderKey`,
 * composed in by `stage-surface-strip.ts` (DL-18.6, 2026-08-16).
 *
 * Stamped on every OPEN, not once per window: closing the chip keeps the page
 * but takes the chip off the strip, so reopening is a new open and belongs at
 * the end — the same rule a reopened file follows.
 */
export const browserOpenedAt = signal(UNSEQUENCED);

/**
 * Whether the browser surface holds the stage right now. Exactly one of
 * {terminal grid, file surface, browser surface} owns the stage; App keeps
 * this and `activeFileTab` mutually exclusive (the two stores never import
 * each other — same seam rule as file-surface-store vs tab-manager).
 */
export const browserSurfaceActive = signal(false);

/** Last state the host published. */
export const browserState = signal<BrowserState>(EMPTY_STATE);

/**
 * One line under the address bar: where the last grab went, or why it did not
 * go anywhere. Cleared by the next navigation or grab.
 */
export const browserNotice = signal<string | null>(null);

/** Reset for tests and for a window that closes its panel. */
export function resetBrowserStore(): void {
  browserOpen.value = false;
  browserOpenedAt.value = UNSEQUENCED;
  browserSurfaceActive.value = false;
  browserState.value = EMPTY_STATE;
  browserNotice.value = null;
}

/** What the store needs from the terminal side to deliver a grab. */
export interface GrabTarget {
  /** Focused pane of the active tab, or null when there is none. */
  activePaneId(): number | null;
  /**
   * Paste into a pane. `autoSend` is deliberately not a parameter: a grab is
   * never submitted (see `deliverGrab`).
   */
  paste(paneId: number, text: string): Promise<boolean>;
}

export type GrabOutcome = "pasted" | "clipboard" | "failed";

/**
 * Whether a grab is allowed to reach a pane at all.
 *
 * Temporarily true since 2026-08-16, at the owner's request: a grab now stops
 * at the clipboard and never types itself into a live agent session. Nothing
 * below was removed — `GrabTarget`, the `paste` seam and its wiring in `App`
 * stay exactly as they were, so reverting is flipping this one constant back
 * to `false` and restoring `grabSummary`'s clipboard/failed wording in
 * `grab-format.ts`.
 *
 * Typed `boolean` rather than left as the literal `true` on purpose: the
 * literal would make the paste branch statically unreachable and invite a
 * reader (or a dead-code pass) to delete the half this constant exists to
 * keep.
 */
const GRAB_PASTE_DISABLED: boolean = true;

/**
 * Deliver one grab.
 *
 * With `GRAB_PASTE_DISABLED` up it goes no further than the clipboard, which
 * needs no work here: react-grab has already written the same snippet there
 * through the page's own copy path. `formatGrab` still runs first, because an
 * empty grab is a failure worth reporting either way — only its `Page: <url>`
 * line goes unused while the paste path is off.
 *
 * When the paste path is on it **pastes and stops** — no Enter, ever, not even
 * behind the Prompt Board's triple gate. The text originates in a web page
 * Deck did not write, and the gate answers "is this pane ready for input", not
 * "did a human write this". A page that can make an agent run a prompt of its
 * choosing is a different class of bug from one that can put text in front of
 * the user, and only the second is acceptable here.
 *
 * `pasteDisabled` defaults to the constant and exists so the kept-for-revert
 * paste path keeps its tests: a branch nothing can reach is a branch that
 * quietly rots until the day someone flips the constant back.
 */
export async function deliverGrab(
  grab: BrowserGrab,
  target: GrabTarget,
  pasteDisabled: boolean = GRAB_PASTE_DISABLED,
): Promise<GrabOutcome> {
  const text = formatGrab(grab);
  if (text === null) {
    return "failed";
  }
  if (pasteDisabled) {
    return "clipboard";
  }
  const paneId = target.activePaneId();
  if (paneId === null) {
    return "clipboard";
  }
  try {
    return (await target.paste(paneId, text)) ? "pasted" : "failed";
  } catch {
    return "failed";
  }
}

export interface BrowserBridgeDeps {
  readonly client: BrowserClient;
  readonly target: GrabTarget;
  /**
   * A committed main-frame navigation — what `browserLastUrl` persists.
   * One settings write per committed navigation, none during load
   * (browser productization §3).
   */
  readonly onCommittedNavigation?: (url: string) => void;
}

/**
 * Subscribe to the host. Returns a teardown for the window's unload path.
 */
export async function initBrowserBridge(deps: BrowserBridgeDeps): Promise<() => void> {
  const unlisteners = await Promise.all([
    deps.client.onState((state) => {
      browserState.value = state;
      if (state.error !== null) {
        browserNotice.value = null;
      }
    }),
    deps.client.onGrab((grab) => {
      void deliverGrab(grab, deps.target).then((outcome) => {
        browserNotice.value = grabSummary(grab.count, outcome);
      });
    }),
    deps.client.onNavigated((url) => {
      deps.onCommittedNavigation?.(url);
    }),
  ]);
  return () => unlisteners.forEach((unlisten) => unlisten());
}

/**
 * Open the browser tab and put its surface on the stage, loading `restore`
 * when nothing is loaded yet — the persisted last page when one exists, the
 * home address otherwise (browser productization §3). The host's own URL gate
 * decides whether the stored value is loadable; an unusable one opens a blank
 * surface, visible and editable.
 *
 * Reopening keeps the page: the toggle is a view, not a session.
 */
export async function openBrowser(client: BrowserClient, restore: string): Promise<void> {
  browserOpen.value = true;
  browserOpenedAt.value = nextOpenSequence();
  browserSurfaceActive.value = true;
  const url = browserState.value.url === "" ? restore : null;
  try {
    browserState.value = await client.open(url);
  } catch (error) {
    console.warn("Deck: the browser surface could not open:", error);
    browserOpen.value = false;
    browserOpenedAt.value = UNSEQUENCED;
    browserSurfaceActive.value = false;
  }
}

/**
 * Put an already-open browser tab back on the stage. The surface mount's own
 * visibility effect tells the host to show the view, so no client call is
 * needed here — this only flips who owns the stage.
 */
export function activateBrowserSurface(): void {
  if (!browserOpen.value) {
    return;
  }
  browserSurfaceActive.value = true;
}

/**
 * The browser steps off the stage (a terminal or file surface took it), but
 * its chip stays on the strip and the page is kept. The host must hide the
 * native view NOW — it paints above every DOM layer, so whatever took the
 * stage would otherwise render under an invisible-to-CSS web page.
 */
export function deactivateBrowserSurface(client: BrowserClient): void {
  if (!browserSurfaceActive.value) {
    return;
  }
  browserSurfaceActive.value = false;
  void client.setVisible(false).catch((error: unknown) => {
    console.warn("Deck: the browser surface could not be hidden:", error);
  });
}

/**
 * Close the browser tab: the chip leaves the strip, keeping the page.
 *
 * It calls `setVisible`, NOT `close`: closing destroys the render process, and
 * closing the chip is something a user hits to get the surface out of the way
 * for a moment. Destroying meant every reopen reloaded the home address,
 * losing the route, the scroll position and any dev-server session — while
 * `open`'s "keep whatever it was showing" branch and the host's own comment
 * about the toggle claimed the opposite. The page is destroyed with its
 * window.
 *
 * `browserState` is deliberately kept: it is what makes the reopen show the
 * same address instead of asking the host for a page it never left.
 */
export async function closeBrowser(client: BrowserClient): Promise<void> {
  browserOpen.value = false;
  // The chip is off the strip, so it holds no place in the open order. The
  // page survives (see above); its position does not.
  browserOpenedAt.value = UNSEQUENCED;
  browserSurfaceActive.value = false;
  browserNotice.value = null;
  try {
    await client.setVisible(false);
  } catch (error) {
    console.warn("Deck: the browser surface could not be hidden:", error);
  }
}
