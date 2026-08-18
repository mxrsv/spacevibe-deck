/**
 * The renderer's view of the browser panel's host side.
 *
 * Same shape as every other `src/host` facade: thin `invoke` wrappers, one
 * `listen` per event, and an interface so the store can be tested without a
 * host bridge.
 */
import { invoke, listen, type UnlistenFn } from '../host/bridge';

/** What the host reports about the page in the panel. */
export interface BrowserState {
  readonly url: string;
  readonly title: string;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly loading: boolean;
  readonly inspect: boolean;
  readonly error: string | null;
}

/** One selection made with Inspect, as the page reported it. */
export interface BrowserGrab {
  readonly text: string;
  readonly url: string;
  readonly title: string;
  readonly count: number;
}

export interface PanelBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface BrowserClient {
  open(url: string | null): Promise<BrowserState>;
  close(): Promise<void>;
  /** Resolves to the URL actually loaded, or null when the input was not one. */
  navigate(url: string): Promise<string | null>;
  back(): Promise<void>;
  forward(): Promise<void>;
  reload(): Promise<void>;
  setBounds(bounds: PanelBounds): Promise<void>;
  setVisible(visible: boolean): Promise<void>;
  setInspect(active: boolean): Promise<void>;
  onState(handler: (state: BrowserState) => void): Promise<UnlistenFn>;
  onGrab(handler: (grab: BrowserGrab) => void): Promise<UnlistenFn>;
  /**
   * Committed main-frame navigations only — never in-page hash changes.
   * What `browserLastUrl` persists (browser productization §3).
   */
  onNavigated(handler: (url: string) => void): Promise<UnlistenFn>;
}

export const defaultBrowserClient: BrowserClient = {
  open: (url) => invoke<BrowserState>('browser_open', { url }),
  close: () => invoke<void>('browser_close'),
  navigate: (url) => invoke<string | null>('browser_navigate', { url }),
  back: () => invoke<void>('browser_back'),
  forward: () => invoke<void>('browser_forward'),
  reload: () => invoke<void>('browser_reload'),
  setBounds: (bounds) => invoke<void>('browser_set_bounds', bounds),
  setVisible: (visible) => invoke<void>('browser_set_visible', { visible }),
  setInspect: (active) => invoke<void>('browser_set_inspect', { active }),
  onState: (handler) => listen<BrowserState>('browser:state', (event) => handler(event.payload)),
  onGrab: (handler) => listen<BrowserGrab>('browser:grab', (event) => handler(event.payload)),
  onNavigated: (handler) =>
    listen<{ url: string }>('browser:navigated', (event) => handler(event.payload.url)),
};
