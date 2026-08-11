/**
 * The browser panel's web content — one `WebContentsView` per Deck window.
 *
 * A `WebContentsView` is a NATIVE view stacked on the window, not an element
 * in Deck's document. Two consequences run through this whole file:
 *
 *  - It paints above every DOM layer, so it cannot be covered by Settings, the
 *    Open board or a popover. The renderer therefore tells the host when to
 *    hide it (`setVisible`), and that is a correctness requirement, not
 *    polish — a panel left visible sits on top of a modal the user is trying
 *    to read.
 *  - It has no layout relationship to the panel it appears inside. The
 *    renderer measures its own placeholder and sends the rectangle; the host
 *    never guesses one.
 *
 * Why not `<webview>`: it would live in the DOM and solve both problems, but it
 * is Electron's own discouraged path, and it puts arbitrary web content inside
 * Deck's renderer process rather than in one of its own.
 */
import path from "node:path";
import {
  shell,
  WebContentsView,
  type BrowserWindow,
  type Rectangle,
} from "electron";
import { isLoadableUrl } from "./url";
import { buildInjection, inspectCall, parseGrabPayload } from "./inject";

/** Every window's browser panel shares one persistent session. */
const PARTITION = "persist:deck-browser";

/** What the renderer needs to paint the panel's chrome. */
export interface BrowserState {
  readonly url: string;
  readonly title: string;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly loading: boolean;
  readonly inspect: boolean;
  /** Human-readable load failure, or `null`. */
  readonly error: string | null;
}

export interface BrowserGrab {
  readonly text: string;
  readonly url: string;
  readonly title: string;
  readonly count: number;
}

export interface BrowserPanelDeps {
  /** Emit to one window. Returns false when the window is gone. */
  readonly emit: (label: string, event: string, payload: unknown) => boolean;
  /** Window by label, or undefined once it has been destroyed. */
  readonly windowFor: (label: string) => BrowserWindow | undefined;
  /** The vendored react-grab bundle, read once by the caller. */
  readonly vendorSource: () => string;
  readonly events: { readonly state: string; readonly grab: string };
  /** Test seam — the real constructor otherwise. */
  readonly createView?: () => WebContentsView;
  /** Test seam — `shell.openExternal` otherwise. */
  readonly openExternal?: (url: string) => void;
}

interface Panel {
  readonly view: WebContentsView;
  bounds: Rectangle;
  visible: boolean;
  inspect: boolean;
  error: string | null;
  /** Set while `loadURL` is in flight, so a failure can be attributed. */
  pending: string | null;
}

export class BrowserPanels {
  private readonly panels = new Map<string, Panel>();

  constructor(private readonly deps: BrowserPanelDeps) {}

  /** Whether this window has a live panel. */
  has(label: string): boolean {
    return this.panels.has(label);
  }

  /**
   * Create the panel if needed and load `url`.
   *
   * Reopening an existing panel with no URL keeps whatever page it was on —
   * closing the panel is a UI toggle, not a reason to lose the session.
   */
  open(label: string, url: string | null): BrowserState {
    const panel = this.panels.get(label) ?? this.create(label);
    if (url !== null && url !== "") {
      this.navigate(label, url);
    }
    // With no URL the panel keeps whatever it was showing; when it has never
    // loaded anything it stays blank rather than inventing a destination.
    return this.stateOf(panel);
  }

  navigate(label: string, url: string): void {
    const panel = this.panels.get(label);
    if (panel === undefined) {
      return;
    }
    panel.error = null;
    panel.pending = url;
    panel.view.webContents.loadURL(url).catch((err: unknown) => {
      // `loadURL` rejects on the same failures `did-fail-load` reports, so the
      // message is already on its way; swallowing keeps an expected navigation
      // error out of the main process log as an unhandled rejection.
      void err;
    });
    this.publish(label);
  }

  goBack(label: string): void {
    const nav = this.panels.get(label)?.view.webContents.navigationHistory;
    if (nav?.canGoBack()) {
      nav.goBack();
    }
  }

  goForward(label: string): void {
    const nav = this.panels.get(label)?.view.webContents.navigationHistory;
    if (nav?.canGoForward()) {
      nav.goForward();
    }
  }

  reload(label: string): void {
    const panel = this.panels.get(label);
    if (panel === undefined) {
      return;
    }
    panel.error = null;
    panel.view.webContents.reload();
  }

  /**
   * Position the view over the renderer's placeholder.
   *
   * Bounds are window-relative CSS pixels. That matches
   * `getBoundingClientRect()` in the renderer because Deck never changes the
   * renderer's zoom factor — its own zoom actions change the terminal font
   * size, not the page (`tab-manager.ts`). Values are rounded and floored at
   * zero: a fractional or negative rectangle is rejected by the native view.
   */
  setBounds(label: string, bounds: Rectangle): void {
    const panel = this.panels.get(label);
    if (panel === undefined) {
      return;
    }
    const next: Rectangle = {
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.max(0, Math.round(bounds.width)),
      height: Math.max(0, Math.round(bounds.height)),
    };
    panel.bounds = next;
    if (panel.visible) {
      panel.view.setBounds(next);
    }
  }

  /**
   * Show or hide without discarding the page.
   *
   * The renderer hides the panel whenever a DOM overlay opens over it, so this
   * runs often; tearing the view down would reload the user's page every time
   * Settings opened.
   */
  setVisible(label: string, visible: boolean): void {
    const panel = this.panels.get(label);
    if (panel === undefined || panel.visible === visible) {
      return;
    }
    panel.visible = visible;
    panel.view.setVisible(visible);
    if (visible) {
      panel.view.setBounds(panel.bounds);
    } else if (panel.inspect) {
      // A hidden view keeps its DOM state, and an inspect overlay left armed
      // would still be armed when the panel comes back — with the pointer
      // somewhere else entirely.
      this.setInspect(label, false);
    }
  }

  setInspect(label: string, active: boolean): void {
    const panel = this.panels.get(label);
    if (panel === undefined) {
      return;
    }
    panel.inspect = active;
    panel.view.webContents
      .executeJavaScript(inspectCall(active))
      .catch(() => {
        // No page, or a page where the bootstrap never ran. The state is still
        // published so the button reflects what the user pressed.
      });
    if (active) {
      // Inspect is a pointer gesture in the page, and the keyboard half of it
      // (⌘C) only reaches react-grab when the page has focus.
      panel.view.webContents.focus();
    }
    this.publish(label);
  }

  close(label: string): void {
    const panel = this.panels.get(label);
    if (panel === undefined) {
      return;
    }
    this.panels.delete(label);
    const window = this.deps.windowFor(label);
    if (window !== undefined && !window.isDestroyed()) {
      window.contentView.removeChildView(panel.view);
    }
    // Destroys the render process behind the view. Without it the page keeps
    // running — timers, sockets and all — for the life of the app.
    panel.view.webContents.close();
  }

  state(label: string): BrowserState | null {
    const panel = this.panels.get(label);
    return panel === undefined ? null : this.stateOf(panel);
  }

  private create(label: string): Panel {
    const view =
      this.deps.createView?.() ??
      new WebContentsView({
        webPreferences: {
          preload: this.preloadPath(),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          // Web content Deck did not write runs here, and it is kept out of
          // the app's own session so a dev server's cookies and storage never
          // mix with anything Deck stores.
          partition: PARTITION,
        },
      });

    const panel: Panel = {
      view,
      bounds: { x: 0, y: 0, width: 0, height: 0 },
      visible: true,
      inspect: false,
      error: null,
      pending: null,
    };
    this.panels.set(label, panel);

    const window = this.deps.windowFor(label);
    window?.contentView.addChildView(view);
    view.setBounds(panel.bounds);

    this.wire(label, panel);
    return panel;
  }

  /**
   * `__dirname` is `dist-electron/electron/browser`, and the preload is built
   * alongside the rest of the host one level up.
   */
  private preloadPath(): string {
    return path.join(__dirname, "..", "browser-preload.cjs");
  }

  private wire(label: string, panel: Panel): void {
    const contents = panel.view.webContents;

    // Inject as early as the document allows. `dom-ready` is before subresources
    // finish, so react-grab is armed while the page is still painting; the
    // `did-finish-load` repeat is a no-op thanks to the bootstrap's guard, and
    // covers a document that swapped in without a `dom-ready` of its own.
    const inject = (): void => {
      contents
        .executeJavaScript(buildInjection(this.deps.vendorSource()))
        .catch((err: unknown) => {
          console.warn("[deck] react-grab injection failed:", err);
        });
    };
    contents.on("dom-ready", inject);
    contents.on("did-finish-load", inject);

    contents.on("did-finish-load", () => {
      panel.pending = null;
      panel.error = null;
      // Inspect is per-document: a navigation replaces the page that was armed.
      panel.inspect = false;
      this.publish(label);
    });

    contents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
      if (!isMainFrame) {
        return;
      }
      // -3 is ERR_ABORTED, which a redirect or a fast second navigation
      // produces routinely. Showing it would put an error bar on a page that
      // loaded fine.
      if (code === -3) {
        return;
      }
      panel.error = `${description || "Load failed"} (${url})`;
      panel.pending = null;
      this.publish(label);
    });

    const publish = (): void => this.publish(label);
    contents.on("did-navigate", publish);
    contents.on("did-navigate-in-page", publish);
    contents.on("page-title-updated", publish);
    contents.on("did-start-loading", publish);
    contents.on("did-stop-loading", publish);

    contents.on("will-navigate", (event, url) => {
      if (!isLoadableUrl(url)) {
        event.preventDefault();
        this.external(url);
      }
    });

    // A target=_blank or window.open goes to the OS browser: a second Electron
    // window would have neither Deck's chrome nor this panel's injection.
    contents.setWindowOpenHandler(({ url }) => {
      this.external(url);
      return { action: "deny" };
    });

    // The panel exists to look at a dev server, and nothing about that needs
    // the camera, the microphone, the user's location or notifications. Denying
    // by default keeps a page from raising a prompt inside Deck's window that
    // looks like it came from Deck.
    contents.session.setPermissionRequestHandler((_wc, _permission, callback) => {
      callback(false);
    });

    contents.ipc.on("deck:browser-grab", (_event, raw: unknown) => {
      const payload = parseGrabPayload(raw);
      if (payload === null) {
        return;
      }
      const grab: BrowserGrab = payload;
      this.deps.emit(label, this.deps.events.grab, grab);
    });
  }

  private external(url: string): void {
    if (!isLoadableUrl(url)) {
      return;
    }
    const open = this.deps.openExternal ?? ((target: string) => {
      void shell.openExternal(target);
    });
    open(url);
  }

  private stateOf(panel: Panel): BrowserState {
    const contents = panel.view.webContents;
    const nav = contents.navigationHistory;
    return {
      url: panel.pending ?? contents.getURL(),
      title: contents.getTitle(),
      canGoBack: nav.canGoBack(),
      canGoForward: nav.canGoForward(),
      loading: contents.isLoading(),
      inspect: panel.inspect,
      error: panel.error,
    };
  }

  private publish(label: string): void {
    const panel = this.panels.get(label);
    if (panel === undefined) {
      return;
    }
    this.deps.emit(label, this.deps.events.state, this.stateOf(panel));
  }
}
