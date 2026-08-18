/**
 * The browser panel's host half, against a fake `WebContentsView`.
 *
 * What is worth asserting here is everything that is invisible from the
 * renderer: that the page gets the injection, that a forged grab is dropped,
 * that a navigation Deck will not load leaves the panel, and that closing the
 * panel actually kills the page rather than leaving it running behind a hidden
 * view.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const opened: string[] = [];

vi.mock('electron', () => ({
  shell: { openExternal: (url: string) => opened.push(url) },
  WebContentsView: class {},
}));

import { BrowserPanels } from './view';

type Handler = (...args: unknown[]) => void;

class FakeContents {
  readonly handlers = new Map<string, Handler[]>();
  readonly ipcHandlers = new Map<string, Handler>();
  readonly executed: string[] = [];
  readonly loaded: string[] = [];
  closed = false;
  destroyed = false;
  focused = false;
  url = '';
  title = '';
  loading = false;
  back = false;
  forward = false;
  windowOpenHandler: ((details: { url: string }) => unknown) | null = null;
  permissionHandler: ((...args: unknown[]) => void) | null = null;

  readonly ipc = {
    on: (channel: string, handler: Handler) => {
      this.ipcHandlers.set(channel, handler);
    },
  };

  readonly navigationHistory = {
    canGoBack: () => this.back,
    canGoForward: () => this.forward,
    goBack: vi.fn(),
    goForward: vi.fn(),
  };

  readonly session = {
    setPermissionRequestHandler: (handler: (...args: unknown[]) => void) => {
      this.permissionHandler = handler;
    },
  };

  on(event: string, handler: Handler): this {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
    return this;
  }

  emit(event: string, ...args: unknown[]): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(...args);
    }
  }

  executeJavaScript(source: string): Promise<unknown> {
    this.executed.push(source);
    return Promise.resolve(null);
  }

  loadURL(url: string): Promise<void> {
    this.loaded.push(url);
    this.url = url;
    return Promise.resolve();
  }

  setWindowOpenHandler(handler: (details: { url: string }) => unknown): void {
    this.windowOpenHandler = handler;
  }

  getURL(): string {
    return this.url;
  }
  getTitle(): string {
    return this.title;
  }
  isLoading(): boolean {
    return this.loading;
  }
  reload = vi.fn();
  isDestroyed(): boolean {
    return this.destroyed;
  }
  close(): void {
    this.closed = true;
  }
  focus(): void {
    this.focused = true;
  }
}

class FakeView {
  readonly webContents = new FakeContents();
  bounds: unknown = null;
  visible = true;
  setBounds(bounds: unknown): void {
    this.bounds = bounds;
  }
  setVisible(visible: boolean): void {
    this.visible = visible;
  }
}

const LABEL = 'main';
const EVENTS = { state: 'browser:state', grab: 'browser:grab' } as const;

function setup() {
  const emitted: { event: string; payload: unknown }[] = [];
  const added: unknown[] = [];
  const removed: unknown[] = [];
  const view = new FakeView();
  let windowFocused = false;
  const window = {
    isDestroyed: () => false,
    webContents: {
      focus: () => {
        windowFocused = true;
      },
    },
    contentView: {
      addChildView: (child: unknown) => added.push(child),
      removeChildView: (child: unknown) => removed.push(child),
    },
  };
  const panels = new BrowserPanels({
    emit: (label, event, payload) => {
      if (label === LABEL) {
        emitted.push({ event, payload });
      }
      return true;
    },
    windowFor: () => window as never,
    vendorSource: () => '/*vendor*/',
    events: EVENTS,
    createView: () => view as never,
  });
  return { panels, view, emitted, added, removed, focusedWindow: () => windowFocused };
}

beforeEach(() => {
  opened.length = 0;
});

describe('BrowserPanels', () => {
  it('creates the view, attaches it and loads the URL', () => {
    const { panels, view, added } = setup();
    panels.open(LABEL, 'http://localhost:3000/');
    expect(added).toEqual([view]);
    expect(view.webContents.loaded).toEqual(['http://localhost:3000/']);
    expect(panels.has(LABEL)).toBe(true);
  });

  it('keeps the page when reopened with no URL', () => {
    const { panels, view } = setup();
    panels.open(LABEL, 'http://localhost:3000/');
    panels.open(LABEL, null);
    expect(view.webContents.loaded).toEqual(['http://localhost:3000/']);
  });

  it('injects react-grab as soon as the document is ready', () => {
    const { panels, view } = setup();
    panels.open(LABEL, 'http://localhost:3000/');
    view.webContents.emit('dom-ready');
    const [script] = view.webContents.executed;
    expect(script).toContain('/*vendor*/');
    expect(script).toContain('telemetry: false');
  });

  it('rounds bounds and refuses a negative size', () => {
    const { panels, view } = setup();
    panels.open(LABEL, null);
    panels.setBounds(LABEL, { x: 10.4, y: 20.6, width: 300.5, height: -8 });
    expect(view.bounds).toEqual({ x: 10, y: 21, width: 301, height: 0 });
  });

  it('hides without discarding the page, and disarms Inspect', () => {
    const { panels, view } = setup();
    panels.open(LABEL, 'http://localhost:3000/');
    panels.setInspect(LABEL, true);
    panels.setVisible(LABEL, false);
    expect(view.visible).toBe(false);
    expect(view.webContents.closed).toBe(false);
    expect(panels.state(LABEL)?.inspect).toBe(false);
    // The deactivate call is what stops a hidden page coming back still armed.
    expect(view.webContents.executed.at(-1)).toContain('deactivate()');
  });

  it('restores the last bounds when shown again', () => {
    const { panels, view } = setup();
    panels.open(LABEL, null);
    panels.setBounds(LABEL, { x: 1, y: 2, width: 3, height: 4 });
    panels.setVisible(LABEL, false);
    view.bounds = null;
    panels.setVisible(LABEL, true);
    expect(view.bounds).toEqual({ x: 1, y: 2, width: 3, height: 4 });
  });

  it('publishes state when the page finishes loading', () => {
    const { panels, view, emitted } = setup();
    panels.open(LABEL, 'http://localhost:3000/');
    view.webContents.title = 'My app';
    view.webContents.back = true;
    view.webContents.emit('did-finish-load');
    const last = emitted.at(-1);
    expect(last?.event).toBe(EVENTS.state);
    expect(last?.payload).toMatchObject({ title: 'My app', canGoBack: true });
  });

  it('reports a load failure but ignores an aborted one', () => {
    const { panels, view } = setup();
    panels.open(LABEL, 'http://localhost:3000/');
    view.webContents.emit('did-fail-load', {}, -3, 'Aborted', 'http://x/', true);
    expect(panels.state(LABEL)?.error).toBeNull();
    view.webContents.emit(
      'did-fail-load',
      {},
      -102,
      'Connection refused',
      'http://localhost:3000/',
      true,
    );
    expect(panels.state(LABEL)?.error).toContain('Connection refused');
  });

  it('forwards a valid grab and drops a forged one', () => {
    const { panels, view, emitted } = setup();
    panels.open(LABEL, 'http://localhost:3000/');
    const handler = view.webContents.ipcHandlers.get('deck:browser-grab');
    handler?.({}, 'not json at all');
    handler?.({}, JSON.stringify({ text: '' }));
    expect(emitted.filter((e) => e.event === EVENTS.grab)).toEqual([]);

    handler?.({}, JSON.stringify({ text: 'grabbed', url: 'http://localhost:3000/' }));
    expect(emitted.at(-1)).toEqual({
      event: EVENTS.grab,
      payload: { text: 'grabbed', url: 'http://localhost:3000/', title: '', count: 1 },
    });
  });

  it('rate-limits grabs, so a page cannot flood the pane', () => {
    // The preload gates on a real user gesture, which a page cannot forge.
    // This is the second gate: a page that finds a way past the first one
    // still cannot paste faster than a human could ask for it.
    const { panels, view, emitted } = setup();
    panels.open(LABEL, 'http://localhost:3000/');
    const handler = view.webContents.ipcHandlers.get('deck:browser-grab');
    for (let i = 0; i < 50; i += 1) {
      handler?.({}, JSON.stringify({ text: `flood ${i}` }));
    }
    expect(emitted.filter((e) => e.event === EVENTS.grab)).toHaveLength(1);
  });

  it('builds the injection once, not per navigation', () => {
    // ~386 kB spliced per load; `dom-ready` and `did-finish-load` both inject.
    const { panels, view } = setup();
    panels.open(LABEL, 'http://localhost:3000/');
    view.webContents.emit('dom-ready');
    view.webContents.emit('did-finish-load');
    const scripts = view.webContents.executed;
    expect(scripts.length).toBeGreaterThan(1);
    expect(scripts[0]).toBe(scripts[1]);
  });

  it('clears the pending address when a load is aborted', () => {
    // ERR_ABORTED is not an error worth showing, but the attempt is over —
    // leaving it pending made the address bar name a page never loaded.
    const { panels, view } = setup();
    panels.open(LABEL, 'http://localhost:3000/');
    view.webContents.url = 'http://localhost:3000/';
    view.webContents.emit('did-fail-load', {}, -3, 'Aborted', 'http://other/', true);
    expect(panels.state(LABEL)?.url).toBe('http://localhost:3000/');
  });

  it('hands keyboard focus back to the window when it hides', () => {
    // `setInspect(true)` put focus in the page; hiding without taking it back
    // sends the user's typing to a view they cannot see.
    const { panels, view, focusedWindow } = setup();
    panels.open(LABEL, 'http://localhost:3000/');
    panels.setInspect(LABEL, true);
    expect(view.webContents.focused).toBe(true);
    panels.setVisible(LABEL, false);
    expect(focusedWindow()).toBe(true);
  });

  it('shows a panel again when it is reopened after the toggle hid it', () => {
    const { panels, view } = setup();
    panels.open(LABEL, 'http://localhost:3000/');
    panels.setVisible(LABEL, false);
    expect(view.visible).toBe(false);
    panels.open(LABEL, null);
    expect(view.visible).toBe(true);
  });

  it('does not close a web contents that is already destroyed', () => {
    // This runs first in the window's `closed` handler, ahead of every step
    // that reclaims the window's panes.
    const { panels, view } = setup();
    panels.open(LABEL, 'http://localhost:3000/');
    view.webContents.destroyed = true;
    panels.close(LABEL);
    expect(view.webContents.closed).toBe(false);
  });

  it('sends a navigation it will not load to the OS browser', () => {
    const { panels, view } = setup();
    panels.open(LABEL, 'http://localhost:3000/');
    const event = { preventDefault: vi.fn() };
    view.webContents.emit('will-navigate', event, 'mailto:someone@example.com');
    expect(event.preventDefault).toHaveBeenCalled();
    // `mailto:` is not loadable in the panel, and it is not something Deck
    // hands to `openExternal` from here either — only http(s) leaves this path.
    expect(opened).toEqual([]);

    const allowed = { preventDefault: vi.fn() };
    view.webContents.emit('will-navigate', allowed, 'https://example.com/');
    expect(allowed.preventDefault).not.toHaveBeenCalled();
  });

  it('denies popups and opens them outside instead', () => {
    const { panels, view } = setup();
    panels.open(LABEL, 'http://localhost:3000/');
    const result = view.webContents.windowOpenHandler?.({
      url: 'https://example.com/docs',
    });
    expect(result).toEqual({ action: 'deny' });
    expect(opened).toEqual(['https://example.com/docs']);
  });

  it('denies every permission the page asks for', () => {
    const { panels, view } = setup();
    panels.open(LABEL, 'http://localhost:3000/');
    const callback = vi.fn();
    view.webContents.permissionHandler?.({}, 'media', callback);
    expect(callback).toHaveBeenCalledWith(false);
  });

  it('closing detaches the view and kills the page', () => {
    const { panels, view, removed } = setup();
    panels.open(LABEL, 'http://localhost:3000/');
    panels.close(LABEL);
    expect(removed).toEqual([view]);
    expect(view.webContents.closed).toBe(true);
    expect(panels.has(LABEL)).toBe(false);
    expect(panels.state(LABEL)).toBeNull();
  });

  it('ignores every command for a window with no panel', () => {
    const { panels } = setup();
    expect(() => {
      panels.navigate(LABEL, 'http://localhost:3000/');
      panels.goBack(LABEL);
      panels.goForward(LABEL);
      panels.reload(LABEL);
      panels.setBounds(LABEL, { x: 0, y: 0, width: 1, height: 1 });
      panels.setVisible(LABEL, false);
      panels.setInspect(LABEL, true);
      panels.close(LABEL);
    }).not.toThrow();
  });
});
