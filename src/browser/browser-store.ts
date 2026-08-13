/**
 * Browser panel state — window-scoped module store of signals (R5).
 *
 * The panel's *content* lives in the host (a native view), so this store holds
 * only what the chrome around it draws, plus the one piece of behaviour worth
 * testing on its own: what happens to a grab.
 */
import { signal } from "@preact/signals";
import type {
  BrowserClient,
  BrowserGrab,
  BrowserState,
} from "./browser-client";
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

/** Whether the docked column is shown. The host view follows this. */
export const browserOpen = signal(false);

/** Last state the host published. */
export const browserState = signal<BrowserState>(EMPTY_STATE);

/**
 * Width during a resize drag; `null` when no drag is in flight and the
 * persisted setting is authoritative.
 *
 * It exists because two elements have to agree on the column's width every
 * frame: the panel itself and the terminal grid it displaces. Committing to
 * settings on every pointermove would write the store dozens of times a
 * second, and letting the panel resize alone would leave the terminals — and
 * the native view's rectangle — a drag behind.
 */
export const browserWidthLive = signal<number | null>(null);

/**
 * One line under the address bar: where the last grab went, or why it did not
 * go anywhere. Cleared by the next navigation or grab.
 */
export const browserNotice = signal<string | null>(null);

/** Reset for tests and for a window that closes its panel. */
export function resetBrowserStore(): void {
  browserOpen.value = false;
  browserWidthLive.value = null;
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
 * Deliver one grab to the focused pane.
 *
 * It **pastes and stops** — no Enter, ever, not even behind the Prompt Board's
 * triple gate. The text originates in a web page Deck did not write, and the
 * gate answers "is this pane ready for input", not "did a human write this".
 * A page that can make an agent run a prompt of its choosing is a different
 * class of bug from one that can put text in front of the user, and only the
 * second is acceptable here.
 *
 * The clipboard needs no work: react-grab has already written the same text
 * there through the page's own copy path, which is what makes "no pane to
 * paste into" a soft landing rather than a lost selection.
 */
export async function deliverGrab(
  grab: BrowserGrab,
  target: GrabTarget,
): Promise<GrabOutcome> {
  const text = formatGrab(grab);
  if (text === null) {
    return "failed";
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
export async function initBrowserBridge(
  deps: BrowserBridgeDeps,
): Promise<() => void> {
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
 * Open the panel, loading `restore` when nothing is loaded yet — the
 * persisted last page when one exists, the home address otherwise (browser
 * productization §3). The host's own URL gate decides whether the stored
 * value is loadable; an unusable one opens a blank panel, visible and
 * editable.
 *
 * Reopening keeps the page: the toggle is a view, not a session.
 */
export async function openBrowser(
  client: BrowserClient,
  restore: string,
): Promise<void> {
  browserOpen.value = true;
  const url = browserState.value.url === "" ? restore : null;
  try {
    browserState.value = await client.open(url);
  } catch (error) {
    console.warn("Deck: the browser panel could not open:", error);
    browserOpen.value = false;
  }
}

/**
 * Hide the panel, keeping the page.
 *
 * It calls `setVisible`, NOT `close`: closing destroys the render process, and
 * the toggle is something a user hits to get the column out of the way for a
 * moment. Destroying meant every reopen reloaded the home address, losing the
 * route, the scroll position and any dev-server session — while `open`'s
 * "keep whatever it was showing" branch and the host's own comment about the
 * toggle claimed the opposite. The page is destroyed with its window.
 *
 * `browserState` is deliberately kept: it is what makes the reopen show the
 * same address instead of asking the host for a page it never left.
 */
export async function closeBrowser(client: BrowserClient): Promise<void> {
  browserOpen.value = false;
  browserNotice.value = null;
  try {
    await client.setVisible(false);
  } catch (error) {
    console.warn("Deck: the browser panel could not be hidden:", error);
  }
}
